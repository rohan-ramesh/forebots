import * as Three from 'three'

import { assert, clamp } from '../util'
import { ILogic, SerialDevice } from './index'

type MotorGroup = {
	frontLeft: SerialDevice<number, never>
	frontRight: SerialDevice<number, never>
	backLeft: SerialDevice<number, never>
	backRight: SerialDevice<number, never>
}

export class CanaryLogic implements ILogic {
	alarmCounts: {
		warning: number
		emergency: number
	} = {
		warning: 0,
		emergency: 0,
	}

	constructor(
		private ifaces: {
			environmentSensors: SerialDevice<string, string>[]
			groundSensors: {
				frontLeft: SerialDevice<never, boolean>
				frontRight: SerialDevice<never, boolean>
				backLeft: SerialDevice<never, boolean>
				backRight: SerialDevice<never, boolean>
			}
			wheelMotors: MotorGroup
			jointServos: {
				hip: MotorGroup
				knee: MotorGroup
			}
			gyroscope: SerialDevice<never, { x: number; y: number; z: number }>
			radio: SerialDevice<string, string>
			bell: SerialDevice<{ kind: 'warning' | 'emergency' | 'none' }, never>
		},
	) {
		assert(ifaces.environmentSensors.length === 6)
	}

	async spinUp() {
		for (let envSensor of this.ifaces.environmentSensors) {
			this.handleEnvSensor(envSensor) // background task
		}

		let groundSensorStats = {
			frontLeft: { lastReading: false },
			frontRight: { lastReading: false },
			backLeft: { lastReading: false },
			backRight: { lastReading: false },
		}
		for (let [name, sensor] of Object.entries(this.ifaces.groundSensors)) {
			sensor.on('data', (data) => {
				groundSensorStats[name as keyof typeof groundSensorStats].lastReading =
					data
			})
		}

		// Determine which joints need to be adjusted based on the gyroscope
		// readings

		let lastGyroscopeTimestamp = 0

		type NavigationState = 'ok' | 'maybe-stuck'
		let navigationStateBuffer: NavigationState[] = [...Array(10)].map(
			() => 'ok',
		)
		let navigationStateIndex = 0
		let navigationAlarm: ReturnType<CanaryLogic['raiseAlarm']> | null = null

		this.ifaces.gyroscope.on('data', (data) => {
			let now = Date.now()
			if (now - lastGyroscopeTimestamp < 1000) {
				return
			}
			lastGyroscopeTimestamp = now

			// Calculate an "upright plane" based on the gyroscope readings. Then,
			// calculate the distance between the upright and ground plane at each
			// point on the ground plane. Finally, adjust the joints so that the
			// distance between the two planes is minimized.

			let { x: rx, y: ry, z: rz } = data
			rx *= Math.PI / 180
			ry *= Math.PI / 180
			rz *= Math.PI / 180
			let normalVec = new Three.Vector3(0, 1, 0).applyEuler(
				new Three.Euler(rx, ry, rz, 'XYZ'),
			)
			let plane = new Three.Plane(normalVec, 0)

			// prettier-ignore
			const POINTS = {
				frontLeft: new Three.Vector3(-0.28, 0.70, 0.20),
				frontRight: new Three.Vector3(0.28, 0.70, 0.20),
				backLeft: new Three.Vector3(-0.40, 0.70, -0.30),
				backRight: new Three.Vector3(0.40, 0.70, -0.30),
			} as const

			let state = 'ok' as NavigationState
			let distances = Object.fromEntries(
				Object.entries(POINTS).map(([name, point]) => {
					let distance = plane.distanceToPoint(point)
					console.log(name, distance)
					let clampedDistance = clamp(distance, Math.sqrt(0.4 ** 2 * 2), 0.8)
					if (distance !== clampedDistance) {
						state = 'maybe-stuck'
					}
					return [name, clampedDistance]
				}),
			)

			if (!Object.values(groundSensorStats).every((x) => x.lastReading)) {
				state = 'maybe-stuck'
			}
			console.log(state)

			// It's not a real robot unless it complains like a Roomba that's stuck
			navigationStateBuffer[navigationStateIndex] = state
			navigationStateIndex =
				(navigationStateIndex + 1) % navigationStateBuffer.length
			if (
				navigationStateBuffer.filter((x) => x === 'maybe-stuck').length >= 5 &&
				!navigationAlarm
			) {
				navigationAlarm = this.raiseAlarm('warning')
			} else if (
				navigationStateBuffer.filter((x) => x === 'ok').length >= 5 &&
				navigationAlarm
			) {
				navigationAlarm.clearAlarm()
				navigationAlarm = null
			}

			for (let [name, distance] of Object.entries(distances)) {
				let hip = this.ifaces.jointServos.hip[name as keyof MotorGroup]
				let knee = this.ifaces.jointServos.knee[name as keyof MotorGroup]

				let hipAngle = Math.acos(distance / 0.8)
				let kneeAngle = 2 * hipAngle

				hip.send(hipAngle * 180 / Math.PI)
				knee.send(kneeAngle * 180 / Math.PI)
			}
		})
	}

	async handleEnvSensor(sensor: SerialDevice<string, string>) {
		let cyclesNotConnected = 0
		let alarm: ReturnType<CanaryLogic['raiseAlarm']> | null = null

		const DANGEROUS_RANGES = {
			// Kelvins
			temperature: {
				min: 273.15 + 5,
				max: 273.15 + 45,
			},
			// Parts per billion
			co: { max: 50_000 },
			h2s: { max: 20_000 },
			co2: { max: 20_000_000 },
		}
		let sensorKind: keyof typeof DANGEROUS_RANGES | 'empty' | null = null

		// Circular buffer of the last 5 readings
		let lastReadings: (number | null)[] = [...Array(5)].map(() => null)
		let lastReadingIndex = 0

		let that = this

		function requestSensor(message: string, timeoutMs: number = 5000) {
			return new Promise<string>((resolve, reject) => {
				let timeout = setTimeout(() => {
					reject(new Error('Timeout'))
				}, timeoutMs)
				sensor.once('data', (data) => {
					clearTimeout(timeout)
					resolve(data)
				})
				sensor.send(message)
			})
		}

		// Use setTimeout here rather than setInterval so that we can ensure that
		// the previous poll has finished before starting the next one, since it
		// can take longer than 1 second to poll the sensor.
		let pollTimeout = null
		poll()

		async function poll() {
			// Unlike setInterval, we are responsible for calling setTimeout again
			// at the end of the function. As such, use a try-finally block to ensure
			// that the loop continues even if an error is thrown.
			try {
				await pollInner()
			} finally {
				pollTimeout = setTimeout(poll, 1000)
			}
		}

		async function pollInner() {
			if (sensor.connected()) {
				cyclesNotConnected = 0
				if (alarm !== null) {
					alarm.clearAlarm()
					alarm = null
				}
			} else {
				cyclesNotConnected++
				if (cyclesNotConnected >= 5 && !alarm) {
					alarm = that.raiseAlarm('warning')
				}
				return
			}

			if (!sensorKind) {
				let kind = await requestSensor('kind')
				if (!DANGEROUS_RANGES.hasOwnProperty(kind) && kind !== 'empty') {
					console.warn('Unknown sensor kind:', kind)
					that.raiseAlarm('warning')
				}
				sensorKind = kind as keyof typeof DANGEROUS_RANGES | 'empty'
				return
			}

			if (sensorKind === 'empty') {
				return
			}

			let reading = await requestSensor('read')
			let readingNum = parseFloat(reading)
			if (isNaN(readingNum)) {
				console.warn('Invalid sensor reading:', reading)
				that.raiseAlarm('warning')
				return
			}

			lastReadings[lastReadingIndex] = readingNum
			lastReadingIndex = (lastReadingIndex + 1) % lastReadings.length
			if (lastReadings.filter((x) => x !== null && isDangerous(x)).length > 3) {
				that.raiseAlarm('emergency', 500_000)
				that.radioSend({
					kind: 'emergency',
					message: `Potentially dangerous levels of ${sensorKind} detected`,
				})
				return
			}

			function isDangerous(reading: number) {
				assert(sensorKind !== 'empty' && sensorKind !== null)
				let range = DANGEROUS_RANGES[sensorKind] as {
					min?: number
					max?: number
				}
				return (
					(range.min !== undefined && reading < range.min) ||
					(range.max !== undefined && reading > range.max)
				)
			}
		}
	}

	/**
	 * Raises an alarm of a given kind and updates the bell to the correct state.
	 * The bell will play a louder alarm during an emergency state than during a
	 * warning state.
	 *
	 * @param durationMs The duration of the alarm in milliseconds. If not
	 * specified, the alarm will continue until `endAlarm` is called.
	 * @returns A function that can be called to end the alarm early.
	 */
	raiseAlarm(kind: 'warning' | 'emergency', durationMs?: number) {
		console.warn('Alarm raised:', kind)

		this.alarmCounts[kind]++
		if (kind === 'emergency' && this.alarmCounts.emergency === 1) {
			this.ifaces.bell.send({ kind })
		} else if (
			kind === 'warning' &&
			this.alarmCounts.warning === 1 &&
			this.alarmCounts.emergency === 0
		) {
			this.ifaces.bell.send({ kind })
		}

		let that = this
		let idempotencyFlag = false

		let timeout: ReturnType<typeof setTimeout> | null = null
		if (durationMs !== undefined) {
			timeout = setTimeout(clearAlarm, durationMs)
		}

		return {
			clearAlarm: () => {
				if (timeout !== null) {
					clearTimeout(timeout)
				}
				clearAlarm()
			},
		}

		function clearAlarm() {
			// Defensive programming doesn't hurt when writing code that could be used
			// in life-or-death situations.
			if (idempotencyFlag) {
				console.warn('Alarm already stopped')
				return
			}
			idempotencyFlag = true

			that.alarmCounts[kind]--
			if (kind === 'emergency' && that.alarmCounts.emergency === 0) {
				if (that.alarmCounts.warning === 0) {
					that.ifaces.bell.send({ kind: 'none' })
				} else {
					that.ifaces.bell.send({ kind: 'warning' })
				}
			} else if (
				kind === 'warning' &&
				that.alarmCounts.warning === 0 &&
				that.alarmCounts.emergency === 0
			) {
				that.ifaces.bell.send({ kind: 'none' })
			}
		}
	}

	radioSend(message: any) {
		this.ifaces.radio.send(JSON.stringify(message))
	}
}
