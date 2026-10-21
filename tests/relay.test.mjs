/**
 * Relay suite: two independent channels (vision / image) and third-party
 * compatibility.
 *
 * Everything here is offline — `fetchImpl` is injected, so no socket is opened
 * and nothing is paid for. What it proves:
 *  - each supported protocol builds the right URL, headers and body;
 *  - each supported response shape is parsed back to text / image bytes;
 *  - the vision key is never sent to the image host and vice versa;
 *  - the auth styles a third-party relay may demand all work;
 *  - bad configuration is rejected with a readable code.
 */
import { encodePng } from '../lib/png.js'
import {
  defaultSettings, normalizeProviderSettings, migrateLegacySettings,
  resolveChannelKey, keyState, channelHeaders, channelUrl, channelUrlForModel,
  buildVisionRequest, buildImageRequest, callVision, generateImage, testProvider,
  RelayError,
} from '../lib/relay.js'

let pass = 0
let fail = 0
const check = (name, condition, extra) => {
  if (condition) pass += 1
  else {
    fail += 1
    console.log(`FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra).slice(0, 700))
  }
}

const png = encodePng((() => {
  const data = new Uint8ClampedArray(4 * 4 * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 200
    data[i + 1] = 120
    data[i + 2] = 60
    data[i + 3] = 255
  }
  return { width: 4, height: 4, data }
})())
const dataUrl = `data:image/png;base64,${png.toString('base64')}`

const respond = (json, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  arrayBuffer: async () => Buffer.from(typeof json === 'string' ? json : JSON.stringify(json)),
  body: null,
})

/** Captures every request and answers from a queue/matcher. */
function stubFetch(answer) {
  const calls = []
  const fetchImpl = async (url, options) => {
    const record = { url: String(url), method: (options && options.method) || 'GET', headers: (options && options.headers) || {}, body: options && options.body }
    if (record.body && typeof record.body === 'string') {
      try {
        record.json = JSON.parse(record.body)
      } catch {
        record.json = null
      }
    }
    calls.push(record)
    return answer(record, calls.length)
  }
  return { calls, fetchImpl }
}

const channel = overrides => Object.assign({}, defaultSettings().vision, overrides)
const imageChannel = overrides => Object.assign({}, defaultSettings().image, overrides)

// ------------------------------------------------------------------ defaults
const defaults = defaultSettings()
check('two channels exist', Boolean(defaults.vision && defaults.image), Object.keys(defaults))
check('vision default is 4o-mini chat', defaults.vision.provider === 'openai_chat' && defaults.vision.model === 'gpt-4o-mini', defaults.vision)
check('image default is images/generations', defaults.image.provider === 'openai_images' && defaults.image.path === '/images/generations', defaults.image)
check('channels carry independent timeouts', defaults.vision.timeout_ms === 120000 && defaults.image.timeout_ms === 300000, [defaults.vision.timeout_ms, defaults.image.timeout_ms])

// ---------------------------------------------------------------- migration
const legacy = migrateLegacySettings({
  base_url: 'https://old.test/v1',
  models: { vision: 'v-old', image: 'i-old', edit: 'e-old' },
  protocols: { vision: 'openai_chat', image: 'openai_chat' },
  paths: { chat: '/chat/completions', images: '/images/generations', edits: '/images/edits' },
  timeout_ms: 9000,
  image_timeout_ms: 99000,
  image_size: '512x512',
  allow_localhost: true,
})
check('legacy shape migrates', legacy && legacy.vision.model === 'v-old' && legacy.image.model === 'i-old', legacy)
check('legacy keeps separate timeouts', legacy.vision.timeout_ms === 9000 && legacy.image.timeout_ms === 99000, legacy)
check('legacy keeps chat image protocol', legacy.image.provider === 'openai_chat', legacy.image)
check('legacy keeps localhost flag', legacy.allow_localhost === true, legacy)
const migrated = normalizeProviderSettings({ base_url: 'https://old.test/v1', models: { vision: 'v' } }, null)
check('normalize accepts legacy input', migrated.vision.base_url === 'https://old.test/v1' && migrated.vision.model === 'v' && migrated.image.base_url === 'https://old.test/v1', migrated)

// ------------------------------------------------------------------- URL/headers
check('relative path joins base', channelUrl(channel({ base_url: 'https://a.test/v1', path: '/chat/completions' })) === 'https://a.test/v1/chat/completions')
check('absolute path wins', channelUrl(channel({ base_url: 'https://a.test/v1', path: 'https://b.test/x?k=1' })) === 'https://b.test/x?k=1')
check('{model} placeholder is expanded', channelUrlForModel(channel({ base_url: 'https://g.test/v1beta', path: '/models/{model}:generateContent', model: 'gemini-2.0-flash' })) === 'https://g.test/v1beta/models/gemini-2.0-flash:generateContent')

const bearer = channelHeaders(channel({ auth: 'bearer' }), 'sk-1')
check('bearer auth header', bearer.authorization === 'Bearer sk-1' && bearer['x-api-key'] === undefined, bearer)
const xkey = channelHeaders(channel({ auth: 'x-api-key' }), 'sk-2')
check('x-api-key auth header', xkey['x-api-key'] === 'sk-2' && xkey.authorization === undefined, xkey)
const apikey = channelHeaders(channel({ auth: 'api-key' }), 'sk-3')
check('api-key auth header', apikey['api-key'] === 'sk-3' && apikey.authorization === undefined, apikey)
const google = channelHeaders(channel({ auth: 'google' }), 'sk-4')
check('google auth header', google['x-goog-api-key'] === 'sk-4' && google.authorization === undefined, google)
const none = channelHeaders(channel({ auth: 'none' }), 'sk-5')
check('none auth sends no key', none.authorization === undefined && none['x-api-key'] === undefined && none['api-key'] === undefined && none['x-goog-api-key'] === undefined, none)
const anthropicHeaders = channelHeaders(channel({ provider: 'anthropic', auth: 'x-api-key' }), 'sk-6')
check('anthropic version header', anthropicHeaders['anthropic-version'] === '2023-06-01', anthropicHeaders)
const custom = channelHeaders(channel({ auth: 'bearer', headers: { 'X-Relay-Token': 'abc', 'x-api-key': 'override' } }), 'sk-7')
check('custom headers merge and win', custom['X-Relay-Token'] === 'abc' && custom['x-api-key'] === 'override' && custom.authorization === 'Bearer sk-7', custom)

// ------------------------------------------------------- vision protocol shapes
const chatShape = buildVisionRequest({ channel: channel(), apiKey: 'sk', prompt: 'P', images: [dataUrl] })
check('chat url/body', chatShape.url === 'https://api.openai.com/v1/chat/completions' && chatShape.body.messages[0].content[1].type === 'image_url', chatShape.body)
check('chat omits detail when auto', chatShape.body.messages[0].content[1].image_url.detail === undefined, chatShape.body.messages[0].content[1])
const chatDetail = buildVisionRequest({ channel: channel({ detail: 'high' }), apiKey: 'sk', prompt: 'P', images: [dataUrl] })
check('chat passes detail', chatDetail.body.messages[0].content[1].image_url.detail === 'high', chatDetail.body.messages[0].content[1])

const responsesShape = buildVisionRequest({ channel: channel({ provider: 'openai_responses', path: '/responses' }), apiKey: 'sk', prompt: 'P', images: [dataUrl] })
check('responses url', responsesShape.url.endsWith('/responses'), responsesShape.url)
check('responses input parts', responsesShape.body.input[0].content[1].type === 'input_image', responsesShape.body)

const anthropicShape = buildVisionRequest({ channel: channel({ provider: 'anthropic', path: '/messages' }), apiKey: 'sk', prompt: 'P', images: [dataUrl] })
check('anthropic url', anthropicShape.url.endsWith('/messages'), anthropicShape.url)
check('anthropic image block', anthropicShape.body.messages[0].content[1].type === 'image' && anthropicShape.body.messages[0].content[1].source.media_type === 'image/png', anthropicShape.body.messages[0].content[1])
check('anthropic max_tokens default', anthropicShape.body.max_tokens === 2048, anthropicShape.body.max_tokens)

const geminiShape = buildVisionRequest({ channel: channel({ provider: 'gemini', base_url: 'https://g.test/v1beta', path: '/models/{model}:generateContent', model: 'gemini-2.0-flash' }), apiKey: 'sk', prompt: 'P', images: [dataUrl] })
check('gemini url expands model', geminiShape.url === 'https://g.test/v1beta/models/gemini-2.0-flash:generateContent', geminiShape.url)
check('gemini inline_data', geminiShape.body.contents[0].parts[1].inline_data.mime_type === 'image/png' && typeof geminiShape.body.contents[0].parts[1].inline_data.data === 'string', geminiShape.body.contents[0].parts[1])

// ------------------------------------------------------- vision response parsing
const chatReply = { choices: [{ message: { content: '{"ok":1}' } }] }
const responsesReply = { output: [{ content: [{ type: 'output_text', text: '{"ok":2}' }] }] }
const anthropicReply = { content: [{ type: 'text', text: '{"ok":3}' }] }
const geminiReply = { candidates: [{ content: { parts: [{ text: '{"ok":4}' }] } }] }

for (const [label, provider, reply, expected, path, baseUrl] of [
  ['chat', 'openai_chat', chatReply, '{"ok":1}', '/chat/completions', 'https://v.test/v1'],
  ['responses', 'openai_responses', responsesReply, '{"ok":2}', '/responses', 'https://v.test/v1'],
  ['anthropic', 'anthropic', anthropicReply, '{"ok":3}', '/messages', 'https://a.test/v1'],
  ['gemini', 'gemini', geminiReply, '{"ok":4}', '/models/{model}:generateContent', 'https://g.test/v1beta'],
]) {
  const stub = stubFetch(() => respond(reply))
  const result = await callVision({
    channel: channel({ provider, path, base_url: baseUrl, model: 'm1' }),
    apiKey: 'sk-vision',
    prompt: 'P',
    images: [dataUrl],
    fetchImpl: stub.fetchImpl,
  })
  check(`vision ${label} parsed`, result.text === expected, result.text)
  check(`vision ${label} hit the right host`, stub.calls[0].url.startsWith(baseUrl), stub.calls[0].url)
  check(`vision ${label} sent the vision key`, JSON.stringify(stub.calls[0].headers).includes('sk-vision'), stub.calls[0].headers)
}

// ------------------------------------------------------- image protocol shapes
const imagesShape = buildImageRequest({ channel: imageChannel(), apiKey: 'sk', prompt: 'P', size: '1024x1024' })
check('images body', imagesShape.kind === 'json' && imagesShape.body.model === 'gpt-image-1' && imagesShape.body.response_format === 'b64_json' && imagesShape.body.n === 1, imagesShape.body)
const imagesQuality = buildImageRequest({ channel: imageChannel({ quality: 'high' }), apiKey: 'sk', prompt: 'P', size: '1024x1024' })
check('images passes quality', imagesQuality.body.quality === 'high', imagesQuality.body)
const chatImage = buildImageRequest({ channel: imageChannel({ provider: 'openai_chat', path: '/chat/completions' }), apiKey: 'sk', prompt: 'P', size: '1024x1024', referenceImages: [dataUrl] })
check('chat image mode', chatImage.kind === 'json' && chatImage.body.messages[0].content[1].type === 'image_url', chatImage.body)
const geminiImage = buildImageRequest({ channel: imageChannel({ provider: 'gemini', base_url: 'https://g.test/v1beta', path: '/models/{model}:generateContent', model: 'gemini-image' }), apiKey: 'sk', prompt: 'P', size: '1024x1024' })
check('gemini image modalities', geminiImage.body.generationConfig.responseModalities[0] === 'TEXT', geminiImage.body.generationConfig)
const editShape = buildImageRequest({ channel: imageChannel({ edit_path: '/images/edits', edit_model: 'gpt-image-1-edit' }), apiKey: 'sk', prompt: 'P', size: '1024x1024', referenceImages: [dataUrl] })
check('edit is multipart', editShape.kind === 'multipart' && editShape.url.endsWith('/images/edits'), editShape)
check('multipart drops json content-type', editShape.headers['content-type'] === undefined, editShape.headers)
check('edit uses edit_model', editShape.model === 'gpt-image-1-edit', editShape.model)

// ------------------------------------------------------- image response parsing
const b64Image = { data: [{ b64_json: png.toString('base64') }] }
const b64Stub = stubFetch(() => respond(b64Image))
const b64Result = await generateImage({ channel: imageChannel(), shared: defaults, apiKey: 'sk-image', prompt: 'P', size: '1024x1024', fetchImpl: b64Stub.fetchImpl })
check('image b64 decoded', b64Result.bytes.length === png.length && b64Result.mime === 'image/png', b64Result)
check('image sent the image key', JSON.stringify(b64Stub.calls[0].headers).includes('sk-image'), b64Stub.calls[0].headers)

const urlStub = stubFetch((record, index) => {
  if (index === 1) return respond({ data: [{ url: 'https://cdn.test/a.png' }] })
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => png,
    body: null,
  }
})
const urlResult = await generateImage({ channel: imageChannel(), shared: defaults, apiKey: 'sk-image', prompt: 'P', size: '1024x1024', fetchImpl: urlStub.fetchImpl })
check('image url downloaded', urlResult.bytes.length === png.length && urlStub.calls.length === 2, urlStub.calls.map(call => call.url))

const markdownStub = stubFetch((record, index) => {
  if (index === 1) return respond({ choices: [{ message: { content: 'Here you go: ![img](https://cdn.test/b.png)' } }] })
  return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => png, body: null }
})
const markdownResult = await generateImage({ channel: imageChannel({ provider: 'openai_chat', path: '/chat/completions' }), shared: defaults, apiKey: 'sk-image', prompt: 'P', size: '1024x1024', fetchImpl: markdownStub.fetchImpl })
check('chat markdown image parsed', markdownResult.bytes.length === png.length, markdownResult)

// ------------------------------------------------------------- key isolation
const isolationStub = stubFetch(() => respond(b64Image))
const secrets = { vision_api_key: 'sk-vision-only', image_api_key: 'sk-image-only' }
const visionKey = resolveChannelKey('vision', secrets, {}).key
const imageKey = resolveChannelKey('image', secrets, {}).key
check('keys resolve per channel', visionKey === 'sk-vision-only' && imageKey === 'sk-image-only', [visionKey, imageKey])

await callVision({ channel: channel(), apiKey: visionKey, prompt: 'P', images: [dataUrl], fetchImpl: stubFetch(() => respond(chatReply)).fetchImpl })
await generateImage({ channel: imageChannel(), shared: defaults, apiKey: imageKey, prompt: 'P', size: '1024x1024', fetchImpl: isolationStub.fetchImpl })
check('image call carried only the image key', JSON.stringify(isolationStub.calls[0].headers).includes('sk-image-only') && JSON.stringify(isolationStub.calls[0].headers).includes('sk-vision-only') === false, isolationStub.calls[0].headers)

const state = keyState(secrets, {})
check('key state reports both channels', state.configured === true && state.vision.source === 'secrets' && state.image.source === 'secrets', state)
const partialState = keyState({ vision_api_key: 'v' }, {})
check('key state reports a missing channel', partialState.has_key === true && partialState.configured === false && partialState.image.has_key === false, partialState)
const envState = keyState({}, { REPLICA_IMAGE_API_KEY: 'env-image' })
check('env keys are per channel', envState.image.source === 'env' && envState.vision.has_key === false, envState)
const legacyKey = resolveChannelKey('vision', { api_key: 'sk-legacy' }, {})
check('legacy single key still works', legacyKey.key === 'sk-legacy', legacyKey)

// ------------------------------------------------------------------ validation
const rejects = (input, name) => {
  try {
    normalizeProviderSettings(input, null)
    check(name, false, 'accepted')
  } catch (error) {
    check(name, error instanceof RelayError && error.code === 'bad-request', error.code)
  }
}
rejects({ vision: { base_url: 'ftp://x.test' } }, 'rejects non-http base_url')
rejects({ vision: { provider: 'nope' } }, 'rejects unknown vision provider')
rejects({ image: { provider: 'nope' } }, 'rejects unknown image provider')
rejects({ image: { auth: 'nope' } }, 'rejects unknown auth style')
rejects({ vision: { headers: { 'bad header': 'x' } } }, 'rejects bad header name')
rejects({ vision: { headers: 'x' } }, 'rejects non-object headers')

const pasted = normalizeProviderSettings({ vision: { base_url: 'https://x.test/v1/chat/completions' } }, null)
check('strips pasted endpoint suffix', pasted.vision.base_url === 'https://x.test/v1' && pasted.vision.path === '/chat/completions', pasted.vision)

const keptOther = normalizeProviderSettings({ vision: { model: 'new-v' } }, defaults)
check('partial save keeps the image channel', keptOther.image.base_url === defaults.image.base_url && keptOther.vision.model === 'new-v', keptOther)

// ------------------------------------------------------------------ test route
const visionTest = await testProvider({
  settings: defaults,
  visionKey: 'sk-v',
  imageKey: 'sk-i',
  kind: 'vision',
  fetchImpl: stubFetch(() => respond(chatReply)).fetchImpl,
})
check('testProvider vision ok', visionTest.ok === true && visionTest.provider === 'openai_chat' && visionTest.model === 'gpt-4o-mini', visionTest)
const imageTest = await testProvider({
  settings: defaults,
  visionKey: 'sk-v',
  imageKey: 'sk-i',
  kind: 'image',
  fetchImpl: stubFetch(() => respond(b64Image)).fetchImpl,
})
check('testProvider image ok', imageTest.ok === true && imageTest.bytes === png.length, imageTest)
try {
  await testProvider({ settings: defaults, visionKey: '', imageKey: 'sk-i', kind: 'vision', fetchImpl: fetch })
  check('testProvider needs the matching key', false, 'accepted')
} catch (error) {
  check('testProvider needs the matching key', error.code === 'provider-missing', error.code)
}

console.log(`PASS ${pass} / FAIL ${fail}`)
if (fail > 0) process.exit(1)
