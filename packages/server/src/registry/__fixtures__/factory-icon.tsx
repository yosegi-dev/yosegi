import type { ReactElement } from "react";

// Fixture for a component whose props can't be read from its type.
// react-docgen-typescript can't trace props for a value created through a factory,
// but it's still a component since calling it returns a React element.

declare function createIcon(): () => ReactElement;

export const FactoryIcon = createIcon();
