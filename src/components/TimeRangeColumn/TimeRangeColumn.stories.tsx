import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { TimeRangeColumn } from "./TimeRangeColumn";
import type { TimeRange } from "./TimeRangeColumn";
import "../../styles.css";

const meta = {
  title: "Components/TimeRangeColumn",
  component: TimeRangeColumn,
  parameters: {
    layout: "centered",
  },
  args: {
    begin: "06:00",
    end: "18:00",
    resolution: 15,
    label: "Zeitfenster planen",
  },
  argTypes: {
    begin: { control: "text" },
    end: { control: "text" },
    resolution: { control: { type: "number", min: 1, max: 120, step: 1 } },
    onChange: { action: "change" },
  },
} satisfies Meta<typeof TimeRangeColumn>;

export default meta;
type Story = StoryObj<typeof meta>;

function ControlledExample(
  props: React.ComponentProps<typeof TimeRangeColumn>,
) {
  const [value, setValue] = useState<TimeRange[]>(
    props.value
      ? [...props.value]
      : [{ start: "09:00", end: "10:30" }],
  );
  return <TimeRangeColumn {...props} value={value} onChange={setValue} />;
}

export const Default: Story = {
  render: (args) => <ControlledExample {...args} />,
};

function RangeActionExample(
  props: React.ComponentProps<typeof TimeRangeColumn>,
) {
  const [value, setValue] = useState<TimeRange[]>([
    { start: "09:00", end: "10:30" },
  ]);
  const [activeRange, setActiveRange] = useState<number | null>(null);

  return (
    <div>
      <TimeRangeColumn
        {...props}
        value={value}
        onChange={setValue}
        onRangeActivate={setActiveRange}
        onRangeCreated={setActiveRange}
        activeRangeIndex={activeRange}
      />
      <output aria-live="polite">
        {activeRange === null
          ? "Noch kein Zeitraum geöffnet"
          : `Zeitraum ${activeRange + 1} geöffnet`}
      </output>
    </div>
  );
}

export const WithRangeActions: Story = {
  render: (args) => <RangeActionExample {...args} />,
};

export const Overlapping: Story = {
  render: (args) => (
    <ControlledExample
      {...args}
      value={[
        { start: "09:00", end: "11:30" },
        { start: "10:00", end: "12:00" },
        { start: "10:30", end: "11:00" },
      ]}
    />
  ),
};

export const WithRangeLabels: Story = {
  render: (args) => (
    <ControlledExample
      {...args}
      value={[
        { start: "07:00", end: "11:00" },
        { start: "13:00", end: "14:00" },
      ]}
      rangeLabels={["Spaziergang", "Kurzer Termin"]}
    />
  ),
};

export const FineResolution: Story = {
  args: {
    begin: "08:00",
    end: "14:00",
    resolution: 5,
    label: "Kurzes Zeitfenster",
  },
  render: (args) => (
    <ControlledExample
      {...args}
      value={[{ start: "10:10", end: "11:00" }]}
    />
  ),
};

export const FullDay: Story = {
  args: {
    begin: "00:00",
    end: "24:00",
    resolution: 30,
    label: "Ganztägige Planung",
  },
  render: (args) => (
    <ControlledExample
      {...args}
      value={[
        { start: "07:30", end: "09:00" },
        { start: "17:00", end: "18:30" },
      ]}
    />
  ),
};

export const NarrowViewport: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  render: (args) => <ControlledExample {...args} />,
};

export const InvalidConfiguration: Story = {
  args: {
    begin: "18:00",
    end: "06:00",
    resolution: 0,
  },
};
