import { createFileRoute } from "@tanstack/react-router";

import { ClockWeatherSettings } from "../components/settings/ClockWeatherSettings";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function WorldClockSettingsPage() {
  return (
    <SettingsPageContainer>
      <ClockWeatherSettings />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/world-clock")({
  component: WorldClockSettingsPage,
});
