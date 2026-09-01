// The dance catalog used to live here as a static array. It's now fetched
// live from BootStepper (see src/lib/bootstepper.ts) so it stays current
// without needing app updates. `venues` stays local — it's the user's own
// list of places they dance, not something BootStepper knows about.

export const venues = [
  { id: "anywhere", name: "Everywhere" },
  { id: "starlight", name: "Starlight Saloon" },
  { id: "boot-scoot", name: "Boot Scoot Social" },
  { id: "copper", name: "The Copper Room" },
  { id: "cancun-cantina", name: "Cancun Cantina" },
  { id: "neon-boots", name: "Neon Boots" },
];
