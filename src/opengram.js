const debug = require('debug')('opengram:core')
const Telegram = require('./telegram')
const Extra = require('./extra')
const Composer = require('./composer')
const Markup = require('./markup')
const session = require('./session')
const Router = require('./router')
const Stage = require('./stage')
const BaseScene = require('./scenes/base')
const { OpengramContext: Context } = require('./context')
const generateCallback = require('./core/network/webhook')
const crypto = require('crypto')
const { URL } = require('url')
const { TelegramError, isTelegramError } = require('./core/error')
const pTimeout = require('p-timeout')
const { compactOptions } = require('./core/helpers/compact')
const WizardScene = require('./scenes/wizard')

const DEFAULT_OPTIONS = {
  retryAfter: 1,
  handlerTimeout: Infinity,
  contextType: Context
}

const noop = () => { }

/**
 * The main class that implements receiving updates and setting up the bot before starting
 *
 * A Opengram bot is an object containing an array of middlewares which are composed and executed in a stack-like
 * manner upon request. Is similar to many other middleware systems that you may have encountered such as Koa,
 * Ruby's Rack, Connect.
 *
 * Middleware is an essential part of any modern framework. It allows you to modify requests and responses as they pass between the Telegram and your bot.
 *
 * You can imagine middleware as a chain of logic connection your bot to the Telegram request.
 *
 * Middleware normally takes two parameters (ctx, next), ctx is the context for one Telegram update, next is a function
 * that is invoked to execute the downstream middleware. It returns a Promise with a then function for running code
 * after completion.
 *
 * ```js
 * const bot = new Opengram(process.env.BOT_TOKEN)
 *
 * bot.use(async (ctx, next) => {
 *   const start = new Date()
 *   await next()
 *   const ms = new Date() - start
 *   console.log('Response time: %sms', ms)
 * })
 *
 * bot.on('text', (ctx) => ctx.reply('Hello World'))
 * bot.launch()
 * ```
 *
 * @extends Composer
 */
class Opengram extends Composer {
  /**
   * @typedef {object} OpengramOptions
   * @property {string} [username] Bot username, used if you don't call `bot.launch()`
   * @property {http.Agent} [attachmentAgent] HTTP Agent used for attachments
   * @property {http.Agent} [agent] HTTP agent used for API calls. By default, it have this configuration:
   *     `new https.Agent({ keepAlive: true, keepAliveMsecs: 10000 })`
   * @property {string} [apiRoot] API root URL
   * @property {boolean} [channelMode=false] If `true`, channel posts can be matched as `text` update type
   * @property {string} [apiPrefix=bot] API prefix before bot token, by default `bot`, but if you use
   *    [TDLight](https://github.com/tdlight-team/tdlight) you maybe should change `apiPrefix` to `user`
   * @property {boolean} [testEnv=false] Enable / disable test environment for WebApps,
   *    see more [here](https://core.telegram.org/bots/webapps#testing-web-apps)
   * @property {boolean} [webhookReply=true] Enable / disable webhook reply
   * @property {number} [retryAfter=1] Interval for retrying long-polling requests in seconds
   * @property {Infinity|number} handlerTimeout Maximum interval for update processing,
   *    after which throwing `TimeoutError`
   */

  /**
   *
   * @param {string} token Bot token given by [@BotFather](https://t.me/BotFather)
   * @param {OpengramOptions} [options] Opengram options
   */
  constructor (token, options) {
    super()
    this.options = {
      ...DEFAULT_OPTIONS,
      ...compactOptions(options)
    }
    this.token = token
    this.handleError = async err => {
      console.error()
      console.error((err.stack || err.toString()).replace(/^/gm, '  '))
      console.error()
      throw err
    }
    this.context = {}
    this.botInfoCall = undefined
    this.polling = {
      offset: 0,
      started: false
    }
  }

  /**
   * Setter for bot token
   *
   * @param {string} token Bot token
   */
  set token (token) {
    this.telegram = new Telegram(token, this.telegram
      ? this.telegram.options
      : this.options.telegram
    )
  }

  /**
   * Getter for bot token
   *
   * @return {string} Bot token
   */
  get token () {
    return this.telegram.token
  }

  /**
   * Setter for enabling / disabling for webhook reply. if assigned `true` - webhook reply enabled
   *
   * @param {boolean} webhookReply Value
   */
  set webhookReply (webhookReply) {
    this.telegram.webhookReply = webhookReply
  }

  /**
   * Returns the status of the webhook reply (enabled / disabled). if `true` is returned, the webhook reply is enabled
   *
   * @return {boolean}
   */
  get webhookReply () {
    return this.telegram.webhookReply
  }

  /**
   * Sets default error handler for Opengram errors.
   * For example if you throw synchronous error or `return` / `await` promise was rejected, it calls this handler,
   * if one is set. If it has not been set - the bot may crash, if some handler like `process.on`
   * does not handle the error.
   * ```js
   * const { Opengram } = require('opengram')
   * const bot = new Opengram('token')
   *
   * async function errorFirst() { throw new Error('Some error') }
   * function second() { return Promise.reject(new Error('Some error')) }
   *
   * // Handled with bot.catch()
   * bot.on('message', ctx => { throw new Error('Some error') })
   *
   * // Handled with bot.catch(), because you return promise (async function with await on async ops)
   * bot.hears('asyncFirst', async ctx => { await errorFirst()  })
   *
   * // Handled with bot.catch(), because you return promise (async function with await on async ops)
   * bot.action('asyncSecond', async ctx => { await second()  })
   *
   * // Handled with bot.catch(), because you return promise
   * bot.action('asyncSecond', ctx => errorFirst())
   *
   * // Handled with bot.catch(), because you return promise
   * bot.on('message', ctx => second())
   *
   * // Bot crashed, error not handled
   * bot.action('asyncSecond', ctx => { errorFirst()  })
   *
   * // Bot crashed, error not handled
   * bot.on('message', async ctx => { second()  })
   *
   * bot.catch((err, ctx) => console.log(err, ctx)) // Print error and error context to console, no crash
   *
   * bot.launch() // Start the bot
   * ```
   *
   * @param {Function} handler Error handler accepting error and context
   * @return {Opengram}
   */
  catch (handler) {
    this.handleError = handler
    return this
  }

  /**
   * @typedef {object} webhookCallbackOptions
   * @property {string} [path='/'] Path the server should listen to.
   * @property {string} [secret] A secret token to be sent in a header “X-Telegram-Bot-Api-Secret-Token”
   *    in every webhook request, 1-256 characters. Only characters A-Z, a-z, 0-9, _ and - are allowed.
   *    The header is useful to ensure that the request comes from a webhook set by you.
   */

  /**
   * Generates webhook handler middleware for specified path for
   * [Koa](https://koajs.com) / [Express](https://expressjs.com)
   * / [Fastify](https://www.fastify.io)
   * / NodeJS [http](https://nodejs.org/api/http.html) or [https](https://nodejs.org/api/https.html) modules
   *
   * Using example for [express](https://expressjs.com):
   * ```js
   * const { Opengram } = require('opengram')
   * const express = require('express')
   * const app = express()
   * const bot = new Opengram(process.env.BOT_TOKEN)
   *
   * // Set the bot response
   * bot.on('text', ({ replyWithHTML }) => replyWithHTML('<b>Hello</b>'))
   *
   * // Set telegram webhook
   * bot.telegram.setWebhook('https://exmaple.com/secret-path')
   *
   * app.get('/', (req, res) => res.send('Hello World!'))
   * // Set the bot API endpoint
   * app.use(bot.webhookCallback('/secret-path'))
   * app.listen(3000, () => console.log('Bot listening on port 3000!'))
   * ```
   *
   * @param {webhookCallbackOptions} config Options
   * @return {Function}
   */
  webhookCallback (config = {}) {
    if (config.path === undefined) config.path = '/'
    return generateCallback(config, (update, res) => this.handleUpdate(update, res), debug)
  }

  /**
   * Starts long polling and updates processing with given configuration
   *
   * @param {number} [timeout=30] Timeout in seconds for long polling. Defaults to 30
   * @param {number} [limit=100] Limits the number of updates to be retrieved. Values between 1-100 are accepted.
   *     Defaults to 100.
   * @param {Array<string>|string} [allowedUpdates] Array of allowed updates or update name
   *     For example, specify `["message", "edited_channel_post", "callback_query"]` to only receive
   *     updates of these types. Please note that this parameter doesn't affect updates created before the call
   *     to the getUpdates, so unwanted updates may be received for a short period of time.
   * @param {Function} [stopCallback] Function called when bot fully stopped.
   *     If you call `bot.stop()` it be rewritten with other function and never called, for using with `bot.stop`,
   *     you can pass `callback` into `bot.stop` argument, for example `bot.stop(() => console.log('Stopped'))`
   * @return {Opengram}
   */
  startPolling (timeout = 30, limit = 100, allowedUpdates, stopCallback = noop) {
    this.polling.timeout = timeout
    this.polling.limit = limit
    this.polling.allowedUpdates = allowedUpdates
      ? Array.isArray(allowedUpdates) ? allowedUpdates : [`${allowedUpdates}`]
      : null
    this.polling.stopCallback = stopCallback
    if (!this.polling.started) {
      this.polling.started = true
      this.fetchUpdates()
    }
    return this
  }

  /**
   * @typedef {object} startWebhookOptions
   * @property {string} path Path the server should listen to.
   * @property {string} [secret] A secret token to be sent in a header “X-Telegram-Bot-Api-Secret-Token”
   *    in every webhook request, 1-256 characters. Only characters A-Z, a-z, 0-9, _ and - are allowed.
   *    The header is useful to ensure that the request comes from a webhook set by you.
   */

  /**
   * Start webhook server based on NodeJS
   * [http](https://nodejs.org/api/http.html) or [https](https://nodejs.org/api/https.html) modules on given host, port
   * ```js
   * const { Opengram } = require('opengram')
   * const fs = require('fs')
   * const bot = new Opengram(process.env.BOT_TOKEN)
   *
   * bot.hears('hello', => ctx.reply('hi'))
   * bot.catch(console.log) // Setup error handler
   *
   * // TLS options
   * const tlsOptions = {
   *     key: fs.readFileSync('server-key.pem'), // Private key file
   *     cert: fs.readFileSync('server-cert.pem') // Certificate file,
   *     ca: [
   *       // This is necessary only if the client uses a self-signed certificate.
   *       fs.readFileSync('client-cert.pem')
   *     ]
   * }
   *
   * // Start webhook server
   * bot.startWebhook(
   *   {
   *     path: '/bot',
   *     secret: '1234567890'
   *   },
   *   tlsOptions,
   *   3000 // Port
   *   '0.0.0.0', // Host, may use if server have multiple IP adders
   *   (req, res) => { // Custom next handler
   *     res.statusCode = 403
   *     res.end('Not allowed!')
   *   }
   * )
   *
   * // Set telegram webhook
   * // The second argument is necessary only if the client uses a self-signed
   * // certificate. Including it for a verified certificate may cause things to break.
   * bot.telegram.setWebhook('https://example.com:3000/bot', {
   *   source: 'server-cert.pem'
   * })
   * ```
   *
   * @param {startWebhookOptions} [options] Webhook options
   * @param {object|null} [tlsOptions] - Options for `https` NodeJS module, see official
   *    [docs](https://nodejs.org/api/https.html#httpscreateserveroptions-requestlistener)
   * @param {number} [port] Port to listen. Be careful, Telegram only supports 443, 80, 88, 8443 for now.
   * @param {string|null} [host] If host is omitted, the server will accept connections on the unspecified IPv6
   *    address (::) when IPv6 is available, or the unspecified IPv4 address (0.0.0.0) otherwise.
   * @param {Function} [nextCb] Next handler function,
   *    called when webhook handler not match path string or request method. May have two arguments - `req`, `res`.
   *    If not specified, by default connection being closed with HTTP status `Forbidden 403`
   * @see https://core.telegram.org/bots/webhooks
   * @see https://core.telegram.org/bots/api#setwebhook
   * @return {Opengram}
   */
  startWebhook (options, tlsOptions, port, host, nextCb) {
    const webhookCb = this.webhookCallback(options)
    const callback = nextCb && typeof nextCb === 'function'
      ? (req, res) => webhookCb(req, res, () => nextCb(req, res))
      : webhookCb
    this.webhookServer = tlsOptions != null
      ? require('https').createServer(tlsOptions, callback)
      : require('http').createServer(callback)
    this.webhookServer.listen(port, host, () => {
      debug('Webhook listening on port: %s', port)
    })
    return this
  }

  /**
   * Generate secret token for webhook path
   *
   * Returns the same result with the same token and `process.version`
   *
   * @return {string} - 256bit hex string, not really random, based on bot token and `process.version`.
   */
  secretPathComponent () {
    return crypto
      .createHash('sha3-256')
      .update(this.token)
      .update(process.version) // salt
      .digest('hex')
  }

  /**
   * @typedef {object} pollingConfig
   * @property {Function} [stopCallback] Function called when bot fully stopped.
   *     If you call `bot.stop()` it be rewritten with other function and never called, for using with `bot.stop`,
   *     you can pass `callback` into `bot.stop` argument, for example `bot.stop(() => console.log('Stopped'))`
   * @property {Array<string>|string} [allowedUpdates] Array of allowed updates or update name
   *     For example, specify `["message", "edited_channel_post", "callback_query"]` to only receive
   *     updates of these types. Please note that this parameter doesn't affect updates created before the call
   *     to the getUpdates, so unwanted updates may be received for a short period of time.
   * @property {number} [limit=100] Limits the number of updates to be retrieved. Values between 1-100 are accepted.
   *     Defaults to 100.
   * @property {number} [timeout=30] Timeout in seconds for long polling. Defaults to 30
   */

  /**
   * @typedef {object} launchWebhookOptions
   * @property {string} [path='/opengram'] Path the server should listen to.
   *    By default - `/opengram` or with enabled {@link webhookConfig#useSecretPath useSecretPath} - `/opengram/<secret>`
   * @property {string} secret A secret token to be sent in a header “X-Telegram-Bot-Api-Secret-Token”
   *    in every webhook request, 1-256 characters. Only characters A-Z, a-z, 0-9, _ and - are allowed.
   *    The header is useful to ensure that the request comes from a webhook set by you.
   *
   *    If not specified, generates an automatic
   */

  /**
   * @typedef {object} webhookConfig
   * @property {boolean} [useSecretPath=true] Enable legacy mode by using the secret in the URL instead of the
   *    secret header.
   * @property {string} domain Your external server domain For example -
   *    `example.com`, `https://exmaple.com`, `http://exmaple.com`.
   *    Used for {@link Opengram.telegram.setWebhook}
   * @property {launchWebhookOptions} options Webhook options object. See {@link Opengram#startWebhook} for more information
   * @property {object} tlsOptions Options for TLS. See {@link Opengram#startWebhook} for more information
   * @property {Function} cb Next handler function, called when webhook handler not match path string or request method.
   *    See {@link Opengram#startWebhook} for more information
   * @property {number} port Port number. See {@link Opengram#startWebhook} for more information
   * @property {string} host Hostname. See {@link Opengram#startWebhook} for more information
   * @property {string} [ipAddress] The fixed IP address which will be used to send webhook requests instead of the
   *    IP address resolved through DNS
   * @property {number} [maxConnections=40] The maximum allowed number of simultaneous HTTPS connections to the webhook
   *    for update delivery, 1-100. Defaults to 40. Use lower values to limit the load on your bot's server, and higher
   *    values to increase your bot's throughput.
   */

  /**
   * @typedef {object} launchConfig
   * @property {boolean} [dropPendingUpdates=false] If sets to true, dropping all pending updates which were sent
   *    when bots bot not was started
   * @property {pollingConfig} [polling] Polling configuration
   * @property {webhookConfig} [webhook] Webhook configuration
   * @property {string[]} [allowedUpdates] Array of allowed updates for **webhook**.
   *    For example, specify ["message", "edited_channel_post", "callback_query"] to only receive
   *    updates of these types. Please note that this parameter doesn't affect updates created before the call
   *    to the setWebhook, so unwanted updates may be received for a short period of time.
   */

  /**
   * Launching a bot with a given config
   *
   * @param {launchConfig} [config] Launch configuration
   * @throws Error
   * @return {Promise<Opengram>}
   */
  async launch (config = {}) {
    debug('Connecting to Telegram')

    const botInfo = await this.telegram.getMe()

    debug(`Launching @${botInfo.username}`)
    this.options.username = botInfo.username
    this.context.botInfo = botInfo
    if (!config.webhook) {
      const { timeout, limit, allowedUpdates, stopCallback } = config.polling || {}
      await this.telegram.deleteWebhook({ drop_pending_updates: config.dropPendingUpdates })
      await this.startPolling(timeout, limit, allowedUpdates, stopCallback)
      debug('Bot started with long-polling')
      return this
    }

    if (
      typeof config.webhook.domain !== 'string' &&
      typeof config.webhook.path !== 'string'
    ) {
      throw new Error('Webhook domain or webhook path is required')
    }

    let domain = config.webhook.domain || ''

    if (domain.startsWith('https://') || domain.startsWith('http://')) {
      domain = new URL(domain).host
    }

    const hookOptions = {}
    if (!config.webhook.path) {
      const secret = this.secretPathComponent()
      hookOptions.path = config.webhook.useSecretPath ? `/opengram/${secret}` : '/opengram'
      if (!config.webhook.useSecretPath) {
        hookOptions.secret = config.webhook.secret || secret
      }
    } else {
      hookOptions.path = config.webhook.path
    }
    const { port, host, tlsOptions, cb } = config.webhook
    this.startWebhook(hookOptions, tlsOptions, port, host, cb)

    if (!domain) {
      debug('Bot started with webhook')
      return this
    }

    const webHookExtra = {
      drop_pending_updates: config.dropPendingUpdates,
      allowed_updates: config.allowedUpdates,
      ip_address: config.webhook.ipAddress,
      max_connections: config.webhook.maxConnections,
      secret_token: hookOptions.secret
    }

    await this.telegram.setWebhook(`https://${domain}${hookOptions.path}`, webHookExtra)
    debug(`Bot started with webhook @ https://${domain}`)

    return this
  }

  /**
   * Stopping the bot. For webhook, it will close the server, for long polling stop getting updates
   *
   * @param {Function} [cb] Callback function, which called when bot fully stopped
   * @return {Promise<void>}
   */
  async stop (cb = noop) {
    debug('Stopping bot...')
    await new Promise((resolve, reject) => {
      const done = () => resolve() & cb()
      if (this.webhookServer) {
        this.webhookServer.close((err) => {
          if (err) reject(err)
          else done()
        })
      } else if (!this.polling.started) {
        done()
      } else {
        this.polling.stopCallback = done
        this.polling.started = false
      }
    })
  }

  /**
   * Starting processing array of updates
   *
   * @param {object[]} updates Array of updates
   * @throws Error
   * @return {Promise}
   */
  handleUpdates (updates) {
    if (!Array.isArray(updates)) {
      throw new Error('Updates must be an array')
    }
    return Promise.all(updates.map((update) => this.handleUpdate(update)))
  }

  /**
   * Starting processing one update
   *
   * @param {object} update Update object
   * @param {object} [webhookResponse] Response object for send webhook reply
   * @throws Error
   * @return {Promise}
   */
  async handleUpdate (update, webhookResponse) {
    if (this.context.botInfo === undefined) {
      debug('Update %d is waiting for `botInfo` to be initialized', update.update_id)
      const getBotInfoPromise = this.botInfoCall || (this.botInfoCall = this.telegram.getMe())
      const botInfo = await getBotInfoPromise
      this.options.username = botInfo.username
      this.context.botInfo = botInfo
    }
    debug('Processing update', update.update_id)
    const tg = new Telegram(this.token, this.telegram.options, webhookResponse)
    const OpengramContext = this.options.contextType
    const ctx = new OpengramContext(update, tg, this.options)
    Object.assign(ctx, this.context)

    try {
      await pTimeout(
        this.middleware()(ctx),
        this.options.handlerTimeout
      )
    } catch (err) {
      return await this.handleError(err, ctx)
    } finally {
      if (webhookResponse && webhookResponse.writableEnded === false) {
        webhookResponse.end()
      }
    }
  }

  /**
   * Fetching updates using long polling
   *
   * @private
   * @return {Promise<void>}
   */
  async fetchUpdates () {
    if (!this.polling.started) {
      this.polling.stopCallback && this.polling.stopCallback()
      return
    }

    const { timeout, limit, offset, allowedUpdates } = this.polling

    let updates = []

    try {
      updates = await this.telegram.getUpdates(timeout, limit, offset, allowedUpdates)
    } catch (err) {
      if (err.code === 401 || err.code === 409) {
        throw err
      }

      const wait = (err.parameters && err.parameters.retry_after) || this.options.retryAfter
      console.error(`Failed to fetch updates. Waiting: ${wait}s`, err.message)

      updates = await new Promise(resolve => setTimeout(resolve, wait * 1000, []))
    }

    try {
      if (this.polling.started && updates.length) {
        await this.handleUpdates(updates)
        this.polling.offset = updates[updates.length - 1].update_id + 1
      }
    } catch (err) {
      console.error('Failed to process updates.', err)
      this.polling.started = false
      this.polling.offset = 0
    }

    this.fetchUpdates()
  }
}

module.exports = Object.assign(Opengram, {
  Context,
  TelegramError,
  isTelegramError,
  Composer,
  default: Opengram,
  Extra,
  Markup,
  Router,
  Opengram,
  Telegram,
  Stage,
  BaseScene,
  Scenes: { BaseScene, WizardScene, Stage },
  session
})
