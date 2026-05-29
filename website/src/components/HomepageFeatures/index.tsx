import type { ReactNode } from "react";
import clsx from "clsx";
import Heading from "@theme/Heading";
import styles from "./styles.module.css";

type FeatureItem = {
  title: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: "Three recovery modes",
    description: (
      <>
        Email + personhood, a pre-registered backup wallet, or M-of-N social
        guardians. Arm one or all three. Each is independent of the others.
      </>
    ),
  },
  {
    title: "ZK-proven email control",
    description: (
      <>
        DKIM signatures are verified inside a Noir circuit. The chain learns
        nothing about the email contents, only that the registered owner sent
        it.
      </>
    ),
  },
  {
    title: "Pluggable personhood",
    description: (
      <>
        World ID today, zkPassport or BrightID tomorrow. Adapters are added via
        a governed propose/confirm flow, with no contract upgrade required.
      </>
    ),
  },
];

function Feature({ title, description }: FeatureItem) {
  return (
    <div className={clsx("col col--4")}>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
