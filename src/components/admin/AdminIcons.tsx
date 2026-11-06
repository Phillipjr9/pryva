import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;
function Icon({ children, ...props }: Props) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}
export function Inbox(props: Props) { return <Icon {...props}><path d="m4 4-2 9v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-2-9Z" /><path d="M2 13h6l2 3h4l2-3h6" /></Icon>; }
export function CalendarDays(props: Props) { return <Icon {...props}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2M8 18h2" /></Icon>; }
export function TrendDown(props: Props) { return <Icon {...props}><path d="m3 7 6 6 4-4 8 8M15 17h6v-6" /></Icon>; }
export function ExternalLink(props: Props) { return <Icon {...props}><path d="M15 3h6v6M10 14 21 3M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></Icon>; }
