import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { BottomNavigation } from './BottomNavigation'
import type { AppSection } from './BottomNavigation'
import '../../styles.css'

const meta = {
  title: 'Components/BottomNavigation',
  component: BottomNavigation,
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'mobile1' },
  },
  args: {
    activeSection: 'pain',
    onChange: () => undefined,
  },
} satisfies Meta<typeof BottomNavigation>

export default meta
type Story = StoryObj<typeof meta>

function ControlledNavigation() {
  const [activeSection, setActiveSection] = useState<AppSection>('pain')

  return (
    <div style={{ minHeight: '100vh' }}>
      <BottomNavigation
        activeSection={activeSection}
        onChange={setActiveSection}
      />
    </div>
  )
}

export const Default: Story = {
  render: () => <ControlledNavigation />,
}

export const ConfigurationActive: Story = {
  args: {
    activeSection: 'configuration',
  },
}
