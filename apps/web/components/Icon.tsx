import type { SVGProps } from "react";

const paths = {
  search: "m21 21-4.4-4.4M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z",
  menu: "M5 6h14M5 12h14M5 18h14",
  home: "m3 11 9-8 9 8M5 10v11h5v-6h4v6h5V10",
  catalog: "M4 4h6v7H4zM14 4h6v7h-6zM4 15h6v5H4zM14 15h6v5h-6z",
  user: "M20 21v-2a7 7 0 0 0-14 0v2M13 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  folder: "M3 7V5h7l2 2h9v13H3Z",
  image: "M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M14 8h.01",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M18 6 6 18",
  erase: "m16 3 5 5-12 12H5l-3-3L16 3ZM9 20h12M9 10l5 5",
  settings:
    "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3ZM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z",
} as const;

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
