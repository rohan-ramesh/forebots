import { EventEmitter } from '../util'

/**
 *
 */
export interface ILogic {}

export interface SerialDevice<ToPeripheral, ToForebot>
	extends EventEmitter<{
		data: ToForebot
		/* connect: void
		disconnect: void */
	}> {
	send(data: ToPeripheral): void
	connected(): boolean
}
