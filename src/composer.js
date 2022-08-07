const { OpengramContext: Context, MessageSubTypesMapping } = require('./context')

class Composer {
  constructor (...fns) {
    this.handler = Composer.compose(fns)
  }

  /**
   * Registers some middleware(s) that receives all updates. It is installed by
   * concatenating it to the end of all previously installed middleware.
   *
   * Often, this method is used to install middleware(s) that behaves like a
   * plugin, for example session middleware.
   * ```js
   * bot.use(session())
   * ```
   *
   * You can pass middleware separated by commas as arguments or as a chain of calls:
   * ```js
   * const { Opengram, Stage, session } = require('opengram')
   * const bot = require('opengram')
   * const stage = new Stage([...])
   * bot.use(session(), stage) // As arguments
   * ```
   * or
   * ```js
   * const { Opengram, Stage, session } = require('opengram')
   * const bot = require('opengram')
   * const stage = new Stage([...])
   * bot // As chain of calls
   *   .use(session())
   *   .use(stage)
   * ```
   *
   * This method returns a new instance of {@link Composer}.
   *
   * @param {MiddlewareFn} fns The middleware(s) to register as arguments
   * @return {Composer}
   */
  use (...fns) {
    this.handler = Composer.compose([this.handler, ...fns])
    return this
  }

  /**
   * Registers some middleware(s) that will only be executed for some specific
   * updates, namely those matching the provided filter query. Filter queries
   * are a concise way to specify which updates you are interested in.
   *
   * Here are some examples of valid filter queries:
   * ```js
   * // All kinds of message updates
   * bot.on('message', ctx => { ... })
   *
   * // Text messages
   * bot.on('text', ctx => { ... })
   *
   * // Messages with document
   * bot.on('document', ctx => { ... })
   * ```
   *
   * It is possible to pass multiple filter queries in an array, i.e.
   * ```js
   * // Matches all messages that contain a video or audio
   * bot.on(['audio', 'video'], ctx => { ... })
   * ```
   *
   * Your middleware will be executed if _any of the provided filter queries_
   * matches (logical OR).
   *
   * This method returns same as {@link Composer#use}.
   *
   * @param {updateType|updateType[]} updateTypes The update type or array of update types to use,
   *    may also be an array or string
   * @param {MiddlewareFn} fns The middleware(s) to register with the given types as argument(s)
   * @return {Composer}
   */
  on (updateTypes, ...fns) {
    return this.use(Composer.mount(updateTypes, ...fns))
  }

  /**
   * Registers some middleware that will only be executed when the message / channel post
   * contains some text (in media caption too). Is it possible to pass a regular expression to match:
   * ```js
   * // Match some text (exact match)
   * bot.hears('I love anime', ctx => ctx.reply('I love too'))
   *
   * // Match a regular expression
   * bot.hears(/\/echo (.+)/, ctx => ctx.reply(ctx.match[1]))
   * ```
   * > Note how `ctx.match` will contain the result of the regular expression.
   * > So `ctx.match[1]` refers to the part of the regex that was matched by `(.+)`,
   * > i.e. the text that comes after "/echo".
   *
   * You can pass an array of triggers. Your middleware will be executed if at
   * least one of them matches.
   *
   * Both text and captions of the received messages will be scanned. For
   * example, when a photo is sent to the chat and its caption matches the
   * trigger, your middleware will be executed.
   *
   * If you only want to match text messages and not captions, you can do
   * this:
   * ```js
   * // Only matches text messages for the regex
   * bot.on('text').hears(/\/echo (.+)/, ctx => { ... })
   * ```
   *
   * @param {string|RegExp|array<RegExp|string>} triggers The text / array of texts or regex to look for
   * @param {MiddlewareFn} fns The middleware(s) to register as argument(s)
   */
  hears (triggers, ...fns) {
    return this.use(Composer.hears(triggers, ...fns))
  }

  /**
   * Registers some middleware that will only be executed when a certain
   * command is found.
   * ```js
   * // Reacts to /start commands
   * bot.command('start', ctx => { ... })
   * // Reacts to /help commands
   * bot.command('help', ctx => { ... })
   * ```
   *
   * > **Note:** Commands are not matched in the middle of the text.
   *
   * ```js
   * bot.command('start', ctx => { ... })
   * // ... does not match:
   * // A message saying: “some text /start some more text”
   * // A photo message with the caption “some text /start some more text”
   * ```
   *
   * By default, commands are detected in channel posts and media captions, too. This means that
   * `ctx.message` for channel post or `ctx.message.text` for media is potentially `undefined`,
   * so you should use `ctx.channelPost` and `ctx.message.caption` accordingly
   * for channel posts. Alternatively, if you
   * want to limit your bot to finding commands only in private and group
   * chats, you can use
   *
   * ```js
   * const { Opengram, Composer: { command } } = require('opengram')
   * // ...
   * bot.on('message', command('start', ctx => ctx.reply('Only private / group messages or media with caption')))`
   * ```
   *
   * or using {@link Composer.chatType}:
   *
   * ```js
   * const { Opengram, Composer, Composer: { command } } = require('opengram')
   * // ...
   * bot.use(
   *   Composer.chatType(
   *     ["private", "group", "supergroup"],
   *     command('start', ctx => ctx.reply('Only private / group messages or media with caption'))
   *   )
   * )
   * ```
   *
   * for match all message exclude channel posts, or
   *
   * ```js
   * const { Opengram, Composer: { command } } = require('opengram')
   * // ...
   * bot.on('text', command('start', ctx => ctx => ctx.reply('Math commands only text, not media captions')))))
   * ```
   *
   * for match only text message, not media caption
   * or even store a message-only version of your bot in a variable like so:
   *
   * > _**Be careful, the example above may not work as expected if `channelMode` is enabled.**_
   * >
   * > By default `text` type not match channel posts, but `channel_post` matched as `text`
   * type when `channelMode` enabled. You can add additional chat type check for this case
   *
   * @param {string|string[]|'start'|'settings'|'help'} commands The command or array of commands to look for
   * @param {MiddlewareFn} fns The middleware(s) to register as arguments
   */
  command (commands, ...fns) {
    return this.use(Composer.command(commands, ...fns))
  }

  action (triggers, ...fns) {
    return this.use(Composer.action(triggers, ...fns))
  }

  inlineQuery (triggers, ...fns) {
    return this.use(Composer.inlineQuery(triggers, ...fns))
  }

  gameQuery (...fns) {
    return this.use(Composer.gameQuery(...fns))
  }

  drop (predicate) {
    return this.use(Composer.drop(predicate))
  }

  filter (predicate) {
    return this.use(Composer.filter(predicate))
  }

  entity (...args) {
    return this.use(Composer.entity(...args))
  }

  email (...args) {
    return this.use(Composer.email(...args))
  }

  phone (...args) {
    return this.use(Composer.phone(...args))
  }

  url (...args) {
    return this.use(Composer.url(...args))
  }

  textLink (...args) {
    return this.use(Composer.textLink(...args))
  }

  textMention (...args) {
    return this.use(Composer.textMention(...args))
  }

  mention (...args) {
    return this.use(Composer.mention(...args))
  }

  hashtag (...args) {
    return this.use(Composer.hashtag(...args))
  }

  cashtag (...args) {
    return this.use(Composer.cashtag(...args))
  }

  spoiler (...args) {
    return this.use(Composer.spoiler(...args))
  }

  start (...fns) {
    return this.command('start', Composer.tap((ctx) => {
      const entity = ctx.message.entities[0]
      ctx.startPayload = ctx.message.text.slice(entity.length + 1)
    }), ...fns)
  }

  help (...fns) {
    return this.command('help', ...fns)
  }

  settings (...fns) {
    return this.command('settings', ...fns)
  }

  middleware () {
    return this.handler
  }

  static reply (...args) {
    return (ctx) => ctx.reply(...args)
  }

  static catchAll (...fns) {
    return Composer.catch((err) => {
      console.error()
      console.error((err.stack || err.toString()).replace(/^/gm, '  '))
      console.error()
    }, ...fns)
  }

  static catch (errorHandler, ...fns) {
    const handler = Composer.compose(fns)
    return (ctx, next) => Promise.resolve(handler(ctx, next))
      .catch((err) => errorHandler(err, ctx))
  }

  static fork (middleware) {
    const handler = Composer.unwrap(middleware)
    return (ctx, next) => {
      setImmediate(handler, ctx, Composer.safePassThru())
      return next(ctx)
    }
  }

  static tap (middleware) {
    const handler = Composer.unwrap(middleware)
    return (ctx, next) => Promise.resolve(handler(ctx, Composer.safePassThru())).then(() => next(ctx))
  }

  static passThru () {
    return (ctx, next) => next(ctx)
  }

  static safePassThru () {
    return (ctx, next) => typeof next === 'function' ? next(ctx) : Promise.resolve()
  }

  static lazy (factoryFn) {
    if (typeof factoryFn !== 'function') {
      throw new Error('Argument must be a function')
    }
    return (ctx, next) => Promise.resolve(factoryFn(ctx))
      .then((middleware) => Composer.unwrap(middleware)(ctx, next))
  }

  static log (logFn = console.log) {
    return Composer.fork((ctx) => logFn(JSON.stringify(ctx.update, null, 2)))
  }

  static branch (predicate, trueMiddleware, falseMiddleware) {
    if (typeof predicate !== 'function') {
      return predicate ? trueMiddleware : falseMiddleware
    }
    return Composer.lazy((ctx) => Promise.resolve(predicate(ctx))
      .then((value) => value ? trueMiddleware : falseMiddleware))
  }

  static optional (predicate, ...fns) {
    return Composer.branch(predicate, Composer.compose(fns), Composer.safePassThru())
  }

  static filter (predicate) {
    return Composer.branch(predicate, Composer.safePassThru(), () => { })
  }

  static drop (predicate) {
    return Composer.branch(predicate, () => { }, Composer.safePassThru())
  }

  static dispatch (routeFn, handlers) {
    return typeof routeFn === 'function'
      ? Composer.lazy((ctx) => Promise.resolve(routeFn(ctx)).then((value) => handlers[value]))
      : handlers[routeFn]
  }

  static mount (updateType, ...fns) {
    const updateTypes = remapMessageSubtypes(normalizeTextArguments(updateType))
    const predicate = (ctx) => updateTypes.includes(ctx.updateType) || updateTypes.some((type) => ctx.updateSubTypes.includes(type))
    return Composer.optional(predicate, ...fns)
  }

  static entity (predicate, ...fns) {
    if (typeof predicate !== 'function') {
      const entityTypes = normalizeTextArguments(predicate)
      return Composer.entity(({ type }) => entityTypes.includes(type), ...fns)
    }
    return Composer.optional((ctx) => {
      const message = ctx.message || ctx.channelPost
      const entities = getEntities(message)
      const text = getText(message)
      return entities && entities.some((entity) =>
        predicate(entity, text.substring(entity.offset, entity.offset + entity.length), ctx)
      )
    }, ...fns)
  }

  static entityText (entityType, predicate, ...fns) {
    if (fns.length === 0) {
      return Array.isArray(predicate)
        ? Composer.entity(entityType, ...predicate)
        : Composer.entity(entityType, predicate)
    }
    const triggers = normalizeTriggers(predicate)
    return Composer.entity(({ type }, value, ctx) => {
      if (type !== entityType) {
        return false
      }
      for (const trigger of triggers) {
        ctx.match = trigger(value, ctx)
        if (ctx.match) {
          return true
        }
      }
    }, ...fns)
  }

  static email (email, ...fns) {
    return Composer.entityText('email', email, ...fns)
  }

  static phone (number, ...fns) {
    return Composer.entityText('phone_number', number, ...fns)
  }

  static url (url, ...fns) {
    return Composer.entityText('url', url, ...fns)
  }

  static textLink (link, ...fns) {
    return Composer.entityText('text_link', link, ...fns)
  }

  static textMention (mention, ...fns) {
    return Composer.entityText('text_mention', mention, ...fns)
  }

  static mention (mention, ...fns) {
    return Composer.entityText('mention', normalizeTextArguments(mention, '@'), ...fns)
  }

  static hashtag (hashtag, ...fns) {
    return Composer.entityText('hashtag', normalizeTextArguments(hashtag, '#'), ...fns)
  }

  static cashtag (cashtag, ...fns) {
    return Composer.entityText('cashtag', normalizeTextArguments(cashtag, '$'), ...fns)
  }

  static spoiler (text, ...fns) {
    return Composer.entityText('spoiler', text, ...fns)
  }

  static match (triggers, ...fns) {
    return Composer.optional((ctx) => {
      const text = getText(ctx.message) ||
        getText(ctx.channelPost) ||
        getText(ctx.callbackQuery) ||
        (ctx.inlineQuery && ctx.inlineQuery.query)
      for (const trigger of triggers) {
        ctx.match = trigger(text, ctx)
        if (ctx.match) {
          return true
        }
      }
    }, ...fns)
  }

  static hears (triggers, ...fns) {
    return Composer.mount('text', Composer.match(normalizeTriggers(triggers), ...fns))
  }

  static command (command, ...fns) {
    if (fns.length === 0) {
      return Composer.entity('bot_command', command)
    }
    const commands = normalizeTextArguments(command, '/')
    return Composer.mount(['message', 'channel_post'], Composer.lazy((ctx) => {
      const groupCommands = ctx.me && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')
        ? commands.map((command) => `${command}@${ctx.me}`)
        : []
      return Composer.entity(({ offset, type }, value) =>
        offset === 0 &&
        type === 'bot_command' &&
        (commands.includes(value) || groupCommands.includes(value))
      , ...fns)
    }))
  }

  static action (triggers, ...fns) {
    return Composer.mount('callback_query', Composer.match(normalizeTriggers(triggers), ...fns))
  }

  static inlineQuery (triggers, ...fns) {
    return Composer.mount('inline_query', Composer.match(normalizeTriggers(triggers), ...fns))
  }

  static acl (userId, ...fns) {
    if (typeof userId === 'function') {
      return Composer.optional(userId, ...fns)
    }
    const allowed = Array.isArray(userId) ? userId : [userId]
    return Composer.optional((ctx) => !ctx.from || allowed.includes(ctx.from.id), ...fns)
  }

  static memberStatus (status, ...fns) {
    const statuses = Array.isArray(status) ? status : [status]
    return Composer.optional((ctx) => ctx.message && ctx.getChatMember(ctx.message.from.id)
      .then(member => member && statuses.includes(member.status))
    , ...fns)
  }

  static admin (...fns) {
    return Composer.memberStatus(['administrator', 'creator'], ...fns)
  }

  static creator (...fns) {
    return Composer.memberStatus('creator', ...fns)
  }

  static chatType (type, ...fns) {
    const types = Array.isArray(type) ? type : [type]
    return Composer.optional((ctx) => {
      const chat = ctx.chat
      return chat !== undefined && types.includes(chat.type)
    }, ...fns)
  }

  static privateChat (...fns) {
    return Composer.chatType('private', ...fns)
  }

  static groupChat (...fns) {
    return Composer.chatType(['group', 'supergroup'], ...fns)
  }

  static gameQuery (...fns) {
    return Composer.mount('callback_query', Composer.optional((ctx) => ctx.callbackQuery.game_short_name, ...fns))
  }

  static unwrap (handler) {
    if (!handler) {
      throw new Error('Handler is undefined')
    }
    return typeof handler.middleware === 'function'
      ? handler.middleware()
      : handler
  }

  static compose (middlewares) {
    if (!Array.isArray(middlewares)) {
      throw new Error('Middlewares must be an array')
    }
    if (middlewares.length === 0) {
      return Composer.safePassThru()
    }
    if (middlewares.length === 1) {
      return Composer.unwrap(middlewares[0])
    }
    return (ctx, next) => {
      let index = -1
      return execute(0, ctx)
      async function execute (i, context) {
        if (!(context instanceof Context)) {
          throw new Error('next(ctx) called with invalid context')
        }
        if (i <= index) {
          throw new Error('next() called multiple times')
        }
        index = i
        const handler = middlewares[i] ? Composer.unwrap(middlewares[i]) : next
        if (!handler) {
          return
        }

        await handler(context, async (ctx = context) => {
          await execute(i + 1, ctx)
        })
      }
    }
  }
}

function normalizeTriggers (triggers) {
  if (!Array.isArray(triggers)) {
    triggers = [triggers]
  }
  return triggers.map((trigger) => {
    if (!trigger) {
      throw new Error('Invalid trigger')
    }
    if (typeof trigger === 'function') {
      return trigger
    }
    if (trigger instanceof RegExp) {
      return (value) => {
        trigger.lastIndex = 0
        return trigger.exec(value || '')
      }
    }
    return (value) => trigger === value ? value : null
  })
}

function normalizeTextArguments (argument, prefix) {
  const args = Array.isArray(argument) ? argument : [argument]
  return args
    .filter(Boolean)
    .map((arg) => prefix && typeof arg === 'string' && !arg.startsWith(prefix) ? `${prefix}${arg}` : arg)
}

function remapMessageSubtypes (subTypes) {
  return subTypes
    .map((type) => MessageSubTypesMapping[type] || type)
}

function getEntities (msg) {
  if (msg == null) return []
  if ('caption_entities' in msg) return msg.caption_entities ?? []
  if ('entities' in msg) return msg.entities ?? []
  return []
}

function getText (
  msg
) {
  if (msg == null) return undefined
  if ('caption' in msg) return msg.caption
  if ('text' in msg) return msg.text
  if ('data' in msg) return msg.data
  if ('game_short_name' in msg) return msg.game_short_name
  return undefined
}

module.exports = Composer
