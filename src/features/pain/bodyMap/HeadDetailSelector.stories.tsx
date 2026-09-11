import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { HeadDetailSelector } from './HeadDetailSelector'
import '../../../styles.css'

const meta = {
  title: 'Features/Pain/HeadDetailSelector',
  component: HeadDetailSelector,
  parameters: { layout: 'padded' },
  args: {
    view: 'front',
    value: [],
    onChange: () => undefined,
    onClose: () => undefined,
  },
} satisfies Meta<typeof HeadDetailSelector>

export default meta
type Story = StoryObj<typeof meta>

function ControlledHeadDetail({
  view,
  initial,
}: {
  view: 'front' | 'back'
  initial: string[]
}) {
  const [value, setValue] = useState(initial)
  return (
    <HeadDetailSelector
      view={view}
      value={value}
      onChange={setValue}
      onClose={() => undefined}
    />
  )
}

export const Front: Story = {
  name: 'Front head detail',
  render: () => (
    <ControlledHeadDetail view="front" initial={['left-eye', 'left-tmj']} />
  ),
}

export const Back: Story = {
  name: 'Back head detail',
  render: () => (
    <ControlledHeadDetail view="back" initial={['neck', 'right-occipital']} />
  ),
}
