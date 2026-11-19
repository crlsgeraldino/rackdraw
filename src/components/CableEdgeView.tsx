'use client';

import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import type { CableEdge } from '@/lib/types';
import { useDisplay } from './useDisplay';

function CableEdgeView(props: EdgeProps<CableEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerStart, markerEnd } = props;
  const pos = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  const [path, labelX, labelY] =
    data?.route === 'straight' ? getStraightPath(pos)
    : data?.route === 'curved' ? getBezierPath(pos)
    : getSmoothStepPath({ ...pos, borderRadius: 8, offset: 16 });
  const style = useDisplay().cable(data);
  const text = [data?.label, data?.vlan && `VLAN ${data.vlan}`].filter(Boolean).join(' · ');

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={{
          stroke: style.color,
          strokeWidth: selected ? style.width + 2 : style.width,
          strokeDasharray: style.dash,
        }}
      />
      {text && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute whitespace-nowrap rounded border bg-white px-1.5 py-0.5 text-[10px] shadow-sm"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, borderColor: style.color, color: style.color }}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { cable: memo(CableEdgeView) };
