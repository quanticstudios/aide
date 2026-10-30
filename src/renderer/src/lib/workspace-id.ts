import { createContext } from 'react'

/** The workspace whose transcript is on screen; file chips resolve paths against it. */
export const WorkspaceIdContext = createContext<string | null>(null)
