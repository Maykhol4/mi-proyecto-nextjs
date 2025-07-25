import type { SVGProps } from "react";

export function AquaViewLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-3.5-6.5a4.5 4.5 0 0 0-9 0C3.5 11.1 5 13 7 14.5c2 1.6 3 3.5 3 5.5a7 7 0 0 0 2 5Z" />
      <path d="M12 3v5" />
      <path d="m5 8 4 4" />
      <path d="m19 8-4 4" />
    </svg>
  );
}
