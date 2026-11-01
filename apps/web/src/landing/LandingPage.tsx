// Composition root of the landing (spec landing, design.md "Files"). Static for now: the world,
// the cellar and its light, the eye and the spiral pumpkin. The status bar (task 4), the set
// (task 5), the gourds (task 6) and the chat (task 7) join here as their tasks land.
import { Eye } from "./Eye";
import styles from "./LandingPage.module.css";
import { Room } from "./Room";
import { Spiral, SpiralThrow } from "./Spiral";
import { World } from "./World";

export function LandingPage() {
  return (
    <section data-page="landing" aria-label="On air" className={styles.landing}>
      <World className={styles.stage}>
        <Room>
          <SpiralThrow />
          {/* The set (task 5) stands here: in front of the thrown light, behind the eye. */}
          <Eye />
          <Spiral />
        </Room>
      </World>
    </section>
  );
}
