import type { ReactNode } from "react";

export type ProfileIconName = "edit" | "eye" | "hidden" | "arrow" | "folder" | "star" | "settings" | "close" | "link" | "image" | "check";
export function ProfileIcon({ name }: { name: ProfileIconName }) {
  const paths: Record<ProfileIconName, ReactNode> = {
    edit: <><path d="m15 4 5 5M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15Z" /><path d="M13 20h7" /></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    hidden: <><path d="m3 3 18 18M10.5 5.1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3 4M6 6.5A19 19 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5-1.2M10 10a3 3 0 0 0 4 4" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="8" cy="7" r="3" /><circle cx="16" cy="17" r="3" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    link: <><path d="m10 14 4-4M8 16l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M16 8l1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg className="profile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
