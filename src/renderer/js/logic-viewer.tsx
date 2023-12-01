import '../css/index.scss'
import '../css/logic-viewer.scss'

import React from 'react'
import ReactDOM from 'react-dom/client'
import * as B from '@blueprintjs/core'
import { CanaryLogic } from './logic/canary'
import { SerialDevice } from './logic'
import { EventEmitter } from './util'

type LogicViewerState = {
	alarmState: 'normal' | 'warning' | 'emergency'
	environmentSensors: {
		type: 'temperature' | 'co' | 'h2s' | 'co2' | 'empty' | 'disconnected'
		value: number
	}[]
	groundSensors: boolean[]
}

class EnvironmentSensor
	extends EventEmitter<{
		data: string
	}>
	implements SerialDevice<string, string>
{
	constructor(
		private options: {
			getKind: () => string
			getValue: () => number
		},
	) {
		super()
	}

	send(data: string) {
		// Their send, our receive
		this.onReceive(data)
	}

	onReceive(data: string) {
		if (this.options.getKind() === 'disconnected') {
			return
		}
		if (data === 'kind') {
			this.emit('data', this.options.getKind())
		}
		if (data === 'value') {
			this.emit('data', this.options.getValue().toString())
		}
	}

	connected() {
		return this.options.getKind() !== 'disconnected'
	}
}

class GroundSensor
	extends EventEmitter<{
		data: boolean
	}>
	implements SerialDevice<never, boolean>
{
	constructor(
		private options: {
			get: () => boolean
		},
	) {
		super()
		setInterval(() => {
			this.emit('data', this.options.get())
		})
	}

	send(data: never) {}

	connected() {
		return true
	}
}

class LogicViewer extends React.Component<{}, LogicViewerState> {
	canary?: CanaryLogic

	constructor(props: {}) {
		super(props)
		this.state = {
			alarmState: 'normal',
			environmentSensors: [
				{ type: 'temperature', value: 303.15 },
				{ type: 'co', value: 100_000 },
				{ type: 'empty', value: 0 },
				{ type: 'empty', value: 0 },
				{ type: 'empty', value: 0 },
				{ type: 'empty', value: 0 },
			],
			groundSensors: [true, true, true, true],
		}
	}

	componentDidMount() {
		let environmentSensors = []
		for (let i = 0; i < 6; i++) {
			environmentSensors.push(
				new EnvironmentSensor({
					getKind: () => this.state.environmentSensors[i].type,
					getValue: () => this.state.environmentSensors[i].value,
				}),
			)
		}

		let groundSensors = {
			frontLeft: new GroundSensor({
				get: () => this.state.groundSensors[0],
			}),
			frontRight: new GroundSensor({
				get: () => this.state.groundSensors[1],
			}),
			backLeft: new GroundSensor({
				get: () => this.state.groundSensors[2],
			}),
			backRight: new GroundSensor({
				get: () => this.state.groundSensors[3],
			}),
		}

		// @ts-ignore
		this.canary = new CanaryLogic({
			environmentSensors,
			groundSensors,
		})
	}

	render() {
		return (
			<div className="logic-viewer">
				<B.H2>Environment Sensors</B.H2>
				<ul>
					{this.state.environmentSensors.map((sensor, i) => (
						<li key={i}>
							<B.ControlGroup>
								<B.Popover
									content={
										<B.Menu>
											<B.MenuItem
												onClick={() => {
													this.setState((state) => {
														state.environmentSensors[i].type = 'temperature'
														return state
													})
												}}
												text="Temperature"
											/>
											<B.MenuItem
												onClick={() => {
													this.setState((state) => {
														state.environmentSensors[i].type = 'co'
														return state
													})
												}}
												text="CO"
											/>
											<B.MenuItem
												onClick={() => {
													this.setState((state) => {
														state.environmentSensors[i].type = 'h2s'
														return state
													})
												}}
												text="H2S"
											/>
											<B.MenuItem
												onClick={() => {
													this.setState((state) => {
														state.environmentSensors[i].type = 'co2'
														return state
													})
												}}
												text="CO2"
											/>
											<B.MenuDivider />
											<B.MenuItem
												onClick={() => {
													this.setState((state) => {
														state.environmentSensors[i].type = 'empty'
														return state
													})
												}}
												text="Disconnected"
											/>
										</B.Menu>
									}
									placement="bottom"
								>
									<B.Button
										alignText="left"
										rightIcon="caret-down"
										className="dropdown-button"
									>
										{sensor.type}
									</B.Button>
								</B.Popover>
								<B.NumericInput
									min={0}
									max={100_000_000}
									value={sensor.value}
									onValueChange={(value) => {
										this.setState((state) => {
											state.environmentSensors[i].value = value
											return state
										})
									}}
									disabled={
										sensor.type === 'empty' || sensor.type === 'disconnected'
									}
								/>
							</B.ControlGroup>
						</li>
					))}
				</ul>

				<B.H2>Ground Sensors</B.H2>
				<ul>
					{this.state.groundSensors.map((sensor, i) => (
						<li key={i}>
							<B.Switch
								checked={sensor}
								onChange={(event) => {
									this.setState((state) => {
										state.groundSensors[i] = !state.groundSensors[i]
										return state
									})
								}}
							>
								{sensor ? 'On' : 'Off'}:{' '}
								{['Front Left', 'Front Right', 'Back Left', 'Back Right'][i]}
							</B.Switch>
						</li>
					))}
				</ul>
			</div>
		)
	}
}

ReactDOM.createRoot(document.getElementById('root')!).render(<LogicViewer />)
