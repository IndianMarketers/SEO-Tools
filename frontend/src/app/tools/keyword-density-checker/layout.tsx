import type { Metadata } from 'next';
import { getToolMetadata, getToolJsonLd } from '@/lib/seo/seoConfig';
import JsonLdScript from '@/components/seo/JsonLdScript';

const SLUG = 'keyword-density-checker';

export const metadata: Metadata = getToolMetadata(SLUG);

export default function KeywordDensityCheckerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jsonLd = getToolJsonLd(SLUG);

  return (
    <>
      <JsonLdScript data={jsonLd} />
      {children}
    </>
  );
}
