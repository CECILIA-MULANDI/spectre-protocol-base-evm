import type { ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import CodeBlock from "@theme/CodeBlock";
import HomepageFeatures from "@site/src/components/HomepageFeatures";
import Heading from "@theme/Heading";

import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/quickstart">
            Quickstart
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/intro"
            style={{ marginLeft: 12 }}>
            What is Spectre?
          </Link>
        </div>
      </div>
    </header>
  );
}

const CODE_SAMPLE = `import { SpectreClient } from '@spectre-protocol/sdk';

const client = new SpectreClient({
  rpcUrl: 'https://sepolia.base.org',
  registryAddress: '0x...',
  privateKey: '0x...',
  prover: { type: 'hosted', url: 'https://relayer.spectreprotocol.xyz' },
});

// 1. Confirm the user controls the email
const { challenge, verify } = client.confirmEmail('alice@example.com');
await challenge();
await verify(codeFromUser);

// 2. Register the agent
await client.register('alice@example.com');

// 3. Optional: arm backup wallet and social guardians
await client.setBackupWallet('0xBackup...');
await client.setGuardians([alice, bob, carol], 2);`;

function HomepageCode() {
  return (
    <section className={styles.codePreview}>
      <div className="container">
        <div className={styles.codePreviewHead}>
          <Heading as="h2" className={styles.codePreviewTitle}>
            From install to recovery
          </Heading>
          <p className={styles.codePreviewLead}>
            The SDK handles proof generation, on-chain transactions, and
            recovery flow state. You hand it an email and a private key; users
            get three independent paths to recover their agent.
          </p>
        </div>
        <div className={styles.codePreviewBlock}>
          <CodeBlock language="ts">{CODE_SAMPLE}</CodeBlock>
        </div>
        <div className={styles.codePreviewCTA}>
          <Link className="button button--primary button--lg" to="/quickstart">
            Read the quickstart
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <HomepageCode />
      </main>
    </Layout>
  );
}
