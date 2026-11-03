// The frame's header slot: a page whose bar drops the breadcrumb (`PageDef.bareBar`) may portal a
// strip of its own into the bar (the Forge's cast). Null until the frame has mounted the slot, and
// on every page whose bar keeps its breadcrumb.
import { createContext, useContext } from "react";

export const HeaderSlot = createContext<HTMLElement | null>(null);

export const useHeaderSlot = (): HTMLElement | null => useContext(HeaderSlot);
