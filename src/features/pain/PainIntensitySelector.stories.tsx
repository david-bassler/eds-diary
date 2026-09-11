import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { PainIntensitySelector } from './PainIntensitySelector'
import '../../styles.css'

const meta = {
  title: 'Features/Pain/PainIntensitySelector',
  component: PainIntensitySelector,
  parameters: {
    layout: 'padded',
  },
  args: {
    value: 6,
    onChange: () => undefined,
  },
} satisfies Meta<typeof PainIntensitySelector>

export default meta
type Story = StoryObj<typeof meta>

function ControlledExample({ initial = 6 }: { initial?: number | null }) {
  const [value, setValue] = useState<number | null>(initial)
  return <PainIntensitySelector value={value} onChange={setValue} />
}

export const Selected: Story = {
  render: () => <ControlledExample />,
}

export const Empty: Story = {
  render: () => <ControlledExample initial={null} />,
}

export const NarrowViewport: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  render: () => <ControlledExample initial={7} />,
}
