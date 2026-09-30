/** One build switch removes the settings and all publication hooks. */
export const DISCORD_FEATURE = import.meta.env?.VITE_ANIMESOUL_PLATFORM !== "android"
  && import.meta.env?.VITE_ANIMESOUL_DISCORD_ENABLED !== "0";
