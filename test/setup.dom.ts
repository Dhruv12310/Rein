import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are off in this repo, so React Testing Library's automatic cleanup is not
// registered. Unmount between tests by hand, or the DOM leaks and queries find stale duplicates.
afterEach(() => cleanup());
