import { checkChoice, createChoiceGroup, createHelpTooltip, createIconButton } from "@foss-earth/ui/browser";
import type { ScenesPanelUi } from "../src/panel.js";

/** UI's choice, action and help factories bound to a test page, as a host binds them to its own. */
export function scenesPanelUi(document: Document): Pick<ScenesPanelUi, "choiceGroup" | "checkChoice" | "iconButton" | "helpTooltip"> {
  return {
    choiceGroup: (name, heading, choices, options) => createChoiceGroup(name, heading, choices, document, options),
    checkChoice,
    iconButton: options => createIconButton(document, options),
    helpTooltip: createHelpTooltip,
  };
}
