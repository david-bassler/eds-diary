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
    docs: {
      description: {
        component:
          'Schmerzregionen werden direkt über die Körperkarte ausgewählt. Hände öffnen passend zur Körperansicht eine Feinauswahl: vorne die Handfläche, hinten der Handrücken. Fingerglieder und Fingergelenke sind getrennt auswählbar.',
      },
    },
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

export const HandDetail: Story = {
  name: 'Front hand · palm detail',
  render: () => (
    <ControlledExample
      initial={[
        {
          view: 'front',
          regionId: 'left-hand',
          detailRegionIds: ['index-middle-phalanx', 'index-middle-joint'],
        },
      ]}
    />
  ),
}

export const HandBackDetail: Story = {
  name: 'Back hand · dorsal detail',
  render: () => (
    <ControlledExample
      initial={[
        {
          view: 'back',
          regionId: 'left-hand',
          detailRegionIds: ['middle-proximal-phalanx', 'middle-base-joint'],
        },
      ]}
    />
  ),
}

export const NarrowViewport: Story = {
  name: 'Mobile swipe and tap',
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
    docs: {
      description: {
        story:
          'Auf kleinen Bildschirmen wechselt ein horizontaler Swipe zwischen Vorder- und Rückseite. Kurze Taps wählen weiterhin Körperregionen aus.',
      },
    },
  },
  render: () => <ControlledExample />,
}
