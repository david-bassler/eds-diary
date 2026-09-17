import type { Meta, StoryObj } from '@storybook/react-vite'
import { LocalSecuritySettings } from './LocalSecuritySettings'

const meta={title:'Settings/LocalSecuritySettings',component:LocalSecuritySettings,parameters:{layout:'centered'}} satisfies Meta<typeof LocalSecuritySettings>
export default meta
type Story=StoryObj<typeof meta>
export const Default:Story={}
export const UnlockGate:Story={args:{unlockOnly:true}}
