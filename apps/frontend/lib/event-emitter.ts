export type EventMap = Record<string, any>
export type EventKey<T extends EventMap> = string & keyof T
export type EventListener<T> = (params: T) => void

export interface Emitter<Map extends EventMap> {
  on<Event extends EventKey<Map>>(event: Event, listener: EventListener<Map[Event]>): () => void
  off<Event extends EventKey<Map>>(event: Event, listener: EventListener<Map[Event]>): void
  emit<Event extends EventKey<Map>>(event: Event, data: Map[typeof event]): void
}

export function createEmitter<Map extends EventMap>(): Emitter<Map> {
  const listeners: {
    [K in keyof EventMap]?: Array<(p: EventMap[K]) => void>
  } = {}

  return {
    on(event, listener) {
      listeners[event] = (listeners[event] || []).concat(listener)

      return () => this.off(event, listener)
    },
    off(event, listener) {
      listeners[event] = (listeners[event] || []).filter((it) => it !== listener)
    },
    emit(event, data) {
      ;(listeners[event] || []).forEach((listener) => listener(data))
    },
  }
}
