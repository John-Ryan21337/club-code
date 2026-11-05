import type { ProviderOptionDescriptor, ProviderOptionSelection } from "@cafecode/contracts";

/** Explicit saved speed choices override native defaults; unsupported choices use standard speed. */
export function normalizeComposerSpeedDescriptors(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): ReadonlyArray<ProviderOptionDescriptor> {
  const savedTier = selections?.find((option) => option.id === "serviceTier")?.value;
  const legacyFast = selections?.find((option) => option.id === "fastMode")?.value === true;
  const tierDescriptor = descriptors.find(
    (option) => option.id === "serviceTier" && option.type === "select",
  );
  return descriptors
    .filter((option) => !tierDescriptor || option.id !== "fastMode")
    .map((descriptor) => {
      if (descriptor.id === "serviceTier" && descriptor.type === "select") {
        const requested = savedTier ?? (legacyFast ? "priority" : "default");
        const options = descriptor.options.filter((option) =>
          ["default", "priority", "ultrafast"].includes(option.id),
        );
        return {
          ...descriptor,
          options: options.map((option) => ({ ...option, isDefault: option.id === "default" })),
          currentValue:
            typeof requested === "string" && options.some((option) => option.id === requested)
              ? requested
              : "default",
        };
      }
      return descriptor.id === "fastMode" && descriptor.type === "boolean"
        ? {
            ...descriptor,
            currentValue: savedTier === undefined ? legacyFast : savedTier === "priority",
          }
        : descriptor;
    });
}
