// The 14 recorded forge jobs under assets/replay/forge, each validated to a Rig (test fixtures for
// the pose goldens; the format is public, so every one of them must keep posing as it did).
import announcer from "../../../../assets/replay/forge/announcer-of-dead-air/job.json";
import auntieAsp from "../../../../assets/replay/forge/auntie-asp/job.json";
import lanternWarden from "../../../../assets/replay/forge/lantern-warden/job.json";
import lotNinety from "../../../../assets/replay/forge/lot-ninety/job.json";
import malakor from "../../../../assets/replay/forge/malakor/job.json";
import mothWidow from "../../../../assets/replay/forge/moth-widow/job.json";
import reveille from "../../../../assets/replay/forge/reveille/job.json";
import saintCardia from "../../../../assets/replay/forge/saint-cardia/job.json";
import sirVacant from "../../../../assets/replay/forge/sir-vacant/job.json";
import sisterVesper from "../../../../assets/replay/forge/sister-vesper/job.json";
import theRedactor from "../../../../assets/replay/forge/the-redactor/job.json";
import theTallyman from "../../../../assets/replay/forge/the-tallyman/job.json";
import understudy from "../../../../assets/replay/forge/understudy/job.json";
import vicar from "../../../../assets/replay/forge/vicar-of-the-lure/job.json";
import type { Rig } from "../types.js";
import { validateRig } from "../validate.js";

const JOBS: Record<string, { rig: unknown }> = {
  "announcer-of-dead-air": announcer,
  "auntie-asp": auntieAsp,
  "lantern-warden": lanternWarden,
  "lot-ninety": lotNinety,
  malakor,
  "moth-widow": mothWidow,
  reveille,
  "saint-cardia": saintCardia,
  "sir-vacant": sirVacant,
  "sister-vesper": sisterVesper,
  "the-redactor": theRedactor,
  "the-tallyman": theTallyman,
  understudy,
  "vicar-of-the-lure": vicar,
};

/** Every recorded job's rig, by slug (throws when one does not validate). */
export function replayRigs(): { slug: string; rig: Rig }[] {
  return Object.entries(JOBS).map(([slug, job]) => {
    const result = validateRig(job.rig);
    if (!result.ok) throw new Error(`${slug}: rig invalid`);
    return { slug, rig: result.value };
  });
}
