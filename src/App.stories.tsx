import type { Meta, StoryObj } from '@storybook/react-vite'
import { App } from './App'
import './styles.css'

const meta = {
  title: 'App/Welcome',
  component: App,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
