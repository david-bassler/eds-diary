import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { PainLocation } from '../painEntry'
import { BodyMapSelector } from './BodyMapSelector'
import '../../../styles.css'

const meta = {
  title: 'Features/Pain/BodyMapSelector',
  component: BodyMapSelector,
  parameters: {
    layout: 'padded',
  },
  args: {
    value: [],
    onChange: () => undefined,
  },
} satisfies Meta<typeof BodyMapSelector>

export default meta
type Story = StoryObj<typeof meta>

function ControlledExample({ initial = [] }: { initial?: PainLocation[] }) {
  const [value, setValue] = useState<PainLocation[]>(initial)
  return <BodyMapSelector value={value} onChange={setValue} />
}

export const Empty: Story = {
  render: () => <ControlledExample />,
}

export const MultipleSelected: Story = {
  render: () => (
    <ControlledExample
      initial={[
        { view: 'front', regionId: 'left-knee' },
        { view: 'back', regionId: 'lower-back' },
      ]}
    />
  ),
}

export const NarrowViewport: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  render: () => <ControlledExample />,
}
