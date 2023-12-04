export function warningBeep() {
	let ctx = new AudioContext()
	let resolveBeep: () => void
	let promiseBeep = new Promise<void>((r) => {
		resolveBeep = r
	})

	let osc: OscillatorNode
	let gain = ctx.createGain()
	gain.connect(ctx.destination)

	for (let i = 0; i < 3; i++) {
		osc = ctx.createOscillator()
		osc.frequency.value = 2000
		osc.start(i * 0.5)
		osc.stop(i * 0.5 + 0.25)
		if (i === 2) {
			osc.addEventListener('ended', () => {
				resolveBeep()
			})
		}

		// Ramp up and down to prevent clicks
		osc.connect(gain)
		gain.gain.setValueAtTime(0, i * 0.5)
		gain.gain.linearRampToValueAtTime(1, i * 0.5 + 0.01)
		gain.gain.linearRampToValueAtTime(1, i * 0.5 + 0.24)
		gain.gain.linearRampToValueAtTime(0, i * 0.5 + 0.25)
	}

	return {
		promise: promiseBeep,
		stop: () =>
			new Promise<void>((resolveStop) => {
				promiseBeep.then(() => resolveStop())
				gain.gain.cancelAndHoldAtTime(ctx.currentTime)
				gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.01)
				osc.stop(ctx.currentTime + 0.01)
				osc.addEventListener('ended', () => {
					resolveBeep()
				})
			}),
	}
}

export function emergencyBeep() {
	let ctx = new AudioContext()

	let lowOsc: OscillatorNode
	let highOsc: OscillatorNode

	let stopping = false
	pushTone(0)

	return {
		stop: () =>
			new Promise<void>((resolve) => {
				stopping = true
				lowOsc.disconnect()
				highOsc.disconnect()

				let gain = ctx.createGain()
				lowOsc.connect(gain)
				highOsc.connect(gain)
				gain.connect(ctx.destination)
				gain.gain.setValueAtTime(1, ctx.currentTime)
				gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.01)

				lowOsc.stop(ctx.currentTime + 0.01)
				highOsc.stop(ctx.currentTime + 0.01)
				lowOsc.addEventListener('ended', () => {
					resolve()
				})
			}),
	}

	function pushTone(i: number) {
		if (stopping) {
			return
		}

		lowOsc = ctx.createOscillator()
		lowOsc.frequency.value = i % 2 === 0 ? 500 : 700
		lowOsc.start()
		lowOsc.stop(ctx.currentTime + 1)

		highOsc = ctx.createOscillator()
		highOsc.frequency.value = i % 2 === 0 ? 1500 : 1700
		highOsc.start()
		highOsc.stop(ctx.currentTime + 1)

		if (i === 0) {
			let gain = ctx.createGain()
			lowOsc.connect(gain)
			highOsc.connect(gain)
			gain.connect(ctx.destination)
			gain.gain.setValueAtTime(0, 0)
			gain.gain.linearRampToValueAtTime(1, 0.01)
		} else {
			lowOsc.connect(ctx.destination)
			highOsc.connect(ctx.destination)
		}

		lowOsc.addEventListener('ended', () => {
			pushTone(i + 1)
		})
	}
}
