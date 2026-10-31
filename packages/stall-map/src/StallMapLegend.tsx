import { STALL_STATUS_LABEL_TH, type StallMapStatus, stallColors } from './status';

export interface StallMapLegendProps {
  zones: { id: string; name: string; color: string }[];
  /** สถานะอื่นนอกจาก "ว่าง" ที่จะแสดงในคำอธิบาย */
  statuses?: Exclude<StallMapStatus, 'AVAILABLE'>[];
}

/** คำอธิบายสี: โซน (ล็อคว่าง) + สถานะที่ใช้ */
export function StallMapLegend({ zones, statuses = [] }: StallMapLegendProps) {
  const items = [
    ...zones.map((z) => ({ key: z.id, label: z.name, colors: stallColors('AVAILABLE', z.color) })),
    ...statuses.map((s) => ({
      key: s,
      label: STALL_STATUS_LABEL_TH[s],
      colors: stallColors(s, '#64748B'),
    })),
  ];
  return (
    <ul
      aria-label="คำอธิบายสี"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 14px',
        margin: 0,
        padding: 0,
        listStyle: 'none',
        fontSize: 13,
        color: '#334155',
      }}
    >
      {items.map((i) => (
        <li key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="16" height="16" aria-hidden="true">
            <rect
              x="1"
              y="1"
              width="14"
              height="14"
              rx="3"
              fill={i.colors.fill}
              stroke={i.colors.stroke}
              strokeWidth="1.5"
              strokeDasharray={i.colors.dash}
            />
          </svg>
          {i.label}
        </li>
      ))}
    </ul>
  );
}
