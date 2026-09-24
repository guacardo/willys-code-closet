import type { ClosetApi } from '../../shared/types'

declare global {
  interface Window {
    closet: ClosetApi
  }
}
