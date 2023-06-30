import * as React from "react";
import Pie, { ProvidedProps, PieArcDatum } from "@visx/shape/lib/shapes/Pie";
import { scaleOrdinal } from "@visx/scale";
import { Group } from "@visx/group";
import { animated, useTransition, to } from "@react-spring/web";
import { cardDeck } from "../../../lib/constants";

const getColor = scaleOrdinal({
  domain: cardDeck,
  range: [
    "fill-red-500 dark:fill-red-700",
    "fill-orange-500 dark:fill-orange-700",
    "fill-lime-500 dark:fill-lime-700",
    "fill-green-500 dark:fill-green-700",
    "fill-cyan-500 dark:fill-cyan-700",
    "fill-blue-500 dark:fill-blue-700",
    "fill-purple-500 dark:fill-purple-700",
    "fill-pink-500 dark:fill-pink-700",
    "fill-amber-500 dark:fill-amber-700",
    "fill-indigo-500 dark:fill-indigo-700",
    "fill-sky-500 dark:fill-sky-700",
    "fill-pink-500 dark:fill-pink-700",
  ],
});

const defaultMargin = { top: 20, right: 20, bottom: 20, left: 20 };

export type PieProps = {
  width: number;
  height: number;
  margin?: typeof defaultMargin;
  animate?: boolean;
  data: { key: string; value: number }[];
};

export default function Example({
  width,
  height,
  margin = defaultMargin,
  animate = true,
  data,
}: PieProps) {
  if (width < 10) return null;

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const radius = Math.min(innerWidth, innerHeight) / 2;
  const centerY = innerHeight / 2;
  const centerX = innerWidth / 2;
  const donutThickness = 50;

  return (
    <svg width={width} height={height}>
      <Group top={centerY + margin.top} left={centerX + margin.left}>
        <Pie
          data={data}
          pieValue={(it) => it.value}
          pieSortValues={() => -1}
          outerRadius={radius - donutThickness * 1.3}
        >
          {(pie) => (
            <AnimatedPie<{ key: string; value: number }>
              {...pie}
              animate={animate}
              getKey={({ data: { key } }) => key}
              getColor={({ data: { key } }) => getColor(String(key))}
            />
          )}
        </Pie>
      </Group>
    </svg>
  );
}

// react-spring transition definitions
type AnimatedStyles = { startAngle: number; endAngle: number; opacity: number };

const fromLeaveTransition = ({ endAngle }: PieArcDatum<any>) => ({
  // enter from 360° if end angle is > 180°
  startAngle: endAngle > Math.PI ? 2 * Math.PI : 0,
  endAngle: endAngle > Math.PI ? 2 * Math.PI : 0,
  opacity: 0,
});
const enterUpdateTransition = ({ startAngle, endAngle }: PieArcDatum<any>) => ({
  startAngle,
  endAngle,
  opacity: 1,
});

type AnimatedPieProps<Datum> = ProvidedProps<Datum> & {
  animate?: boolean;
  getKey: (d: PieArcDatum<Datum>) => string;
  getColor: (d: PieArcDatum<Datum>) => string;
  delay?: number;
};

function AnimatedPie<Datum>({
  animate,
  arcs,
  path,
  getKey,
  getColor,
}: AnimatedPieProps<Datum>) {
  const transitions = useTransition<PieArcDatum<Datum>, AnimatedStyles>(arcs, {
    from: animate ? fromLeaveTransition : enterUpdateTransition,
    enter: enterUpdateTransition,
    update: enterUpdateTransition,
    leave: animate ? fromLeaveTransition : enterUpdateTransition,
    keys: getKey,
  });
  return transitions((props, arc, { key }) => {
    const [centroidX, centroidY] = path.centroid(arc);
    const hasSpaceForLabel = arc.endAngle - arc.startAngle >= 0.3;

    return (
      <g key={key}>
        <animated.path
          // compute interpolated path d attribute from intermediate angle values
          d={to([props.startAngle, props.endAngle], (startAngle, endAngle) =>
            path({
              ...arc,
              startAngle,
              endAngle,
            })
          )}
          className={getColor(arc)}
        />
        <animated.g style={{ opacity: props.opacity }}>
          <text
            fill={hasSpaceForLabel ? "white" : "black"}
            x={hasSpaceForLabel ? centroidX : centroidX * 2.2}
            y={hasSpaceForLabel ? centroidY : centroidY * 2.2}
            dy=".33em"
            fontSize={36}
            textAnchor="middle"
            pointerEvents="none"
          >
            {getKey(arc)}
          </text>
        </animated.g>
      </g>
    );
  });
}
