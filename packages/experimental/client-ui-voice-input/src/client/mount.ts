/** Source-safe lifecycle for the optional speech Remote and browser UI. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-experimental-api-speech-to-text/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { VoiceInput, type VoiceInputInjected } from './VoiceInput.tsx'
import { Recording } from './audio.ts'
import { createMicrophoneDeviceStore } from './microphone-device.ts'
import { en, NS, zh } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { observeReadiness } from './readiness.ts'
import { VoicePreparation } from './PreparationCard.tsx'
import { VoiceSetupPrompt } from './VoiceSetupPrompt.tsx'
import { VoiceStartupModelModal } from './VoiceStartupModelModal.tsx'

export const inject = ['remote', 'slots', 'locale', 'pluginNavigation']

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const recordings = new Set<Recording>()
  const microphone = createMicrophoneDeviceStore()
  const readiness = observeReadiness(ctx)
  // Start preparing the selected local ASR model as soon as the voice plugin is
  // available. Do not make the user find the Settings download button on first use.
  // Cloud providers and already-ready local models never download anything.
  // A failed automatic attempt stays visible in the existing preparation UI; manual
  // retry and source selection are still available without endless download loops.
  const autoAttempted = new Set<string>()
  const prepareSelectedLocalModel = (): void => {
    const snapshot = readiness.state.getSnapshot()
    const catalog = snapshot.catalog
    if (!snapshot.connected || catalog === null) return
    const selected = catalog.providers.find(provider => provider.id === catalog.selection.providerId)
    if (selected === undefined || selected.location !== 'host-local'
      || selected.preparation.phase !== 'unprepared' || autoAttempted.has(selected.id)) return
    autoAttempted.add(selected.id)
    void ctx.remote.speech.prepare(selected.id).then((result) => {
      if (!result.ok) console.warn('voice input: automatic local model preparation failed', result.error.message)
    }).catch((error: unknown) => {
      console.warn('voice input: automatic local model preparation unavailable', error instanceof Error ? error.message : String(error))
    })
  }
  const unsubscribeAutoPreparation = readiness.state.subscribe(prepareSelectedLocalModel)
  ctx.effect(() => unsubscribeAutoPreparation)
  prepareSelectedLocalModel()
  ctx.effect(() => readiness.dispose)
  ctx.effect(() => async () => { await Promise.all([...recordings].map(recording => recording.dispose())) })
  const actions: VoiceInputInjected = {
    openSettings: () => { ctx.pluginNavigation.openBundle('@deepseek-ai/dsh-experimental-voice-input-bundle') },
    hooks: { speechReadiness: readiness.state, microphoneDevice: microphone },
    selectMicrophone: (device) => { microphone.set(device) },
    createRecording: () => {
      const recording = new Recording(() => { recordings.delete(recording) }, microphone.getSnapshot().id)
      recordings.add(recording)
      return recording
    },
    transcribe: async (request, signal) => await ctx.remote.speech.transcribe(request, signal),
    configure: async (patch) => { const result = await ctx.remote.speech.configure(patch); if (!result.ok) throw result.error },
    prepare: async (providerId, options) => {
      const result = await ctx.remote.speech.prepare(providerId, options); if (!result.ok) throw result.error
    },
    cancelPreparation: async (providerId) => {
      const result = await ctx.remote.speech.cancelPreparation(providerId); if (!result.ok) throw result.error
    },
  }
  // Global first-run prompt: visible before any conversation has been opened.
  // The component only renders inside the trusted Maohao Windows desktop.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'maohao.voice-model-startup', locale: NS, inject: () => actions,
  }, VoiceStartupModelModal))
  ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
    name: 'conversation.input.activity', locale: NS, inject: () => actions,
  }, VoiceInput))
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config',
    key: '@deepseek-ai/dsh-experimental-voice-input-bundle', locale: NS, inject: () => actions,
  }, VoicePreparation))
  ctx.slots.inject('plugins.bundle.activation', () => ctx.slots.register({ name: 'plugins.bundle.activation',
    key: '@deepseek-ai/dsh-experimental-voice-input-bundle', locale: NS, inject: () => actions,
  }, VoiceSetupPrompt))

}

/**
 * Mount this experimental namespace without adding it to stable API Remotes.
 * @param ctx - Client runtime owning the Remote, dictionaries and slots.
 * @param contribution - generated speech Remote definitions.
 * @returns disposer joining UI and Remote withdrawal.
 */
export async function mountVoiceInput(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.speech', 'slots', 'locale', 'pluginNavigation'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
