import { createLogger } from '../../logger';

const logger = createLogger('DepDocsFetcher');

interface PackageDoc {
    name: string;
    version: string;
    description: string;
    readme: string;
    fetchedAt: number;
}

/**
 * Well-known packages whose docs are already in COMMON_DEP_DOCUMENTATION.
 * Skip fetching these to save time and bandwidth.
 */
const SKIP_PACKAGES = new Set([
    'react', 'react-dom', 'typescript', 'vite', 'tailwindcss',
    'zustand', 'immer', 'zod', 'clsx', 'tailwind-merge',
    'lucide-react', 'framer-motion', 'recharts', 'axios',
    'date-fns', 'dayjs', 'uuid', 'nanoid', 'sonner',
]);

/**
 * Extract clean package names from a blueprint's frameworks list.
 * Handles entries like "react-router@7", "shadcn/ui", "@tanstack/react-query v5"
 */
function extractPackageNames(frameworks: string[]): string[] {
    return frameworks
        .map(f => f.trim())
        .map(f => {
            // Remove version specifiers: "@7", "v5", "^2.0", " latest"
            const cleaned = f
                .replace(/[@^~]?\d+(\.\d+)*$/g, '')
                .replace(/\s+v?\d+(\.\d+)*$/g, '')
                .replace(/\s+latest$/g, '')
                .trim();
            return cleaned;
        })
        .filter(f => f.length > 0)
        .filter(f => !SKIP_PACKAGES.has(f.toLowerCase()));
}

/**
 * Fetch package metadata and README from the npm registry.
 * Returns a condensed version suitable for LLM context injection.
 */
async function fetchPackageDoc(packageName: string): Promise<PackageDoc | null> {
    try {
        const response = await fetch(
            `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
            {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(8000),
            }
        );

        if (!response.ok) {
            logger.warn(`npm registry returned ${response.status} for ${packageName}`);
            return null;
        }

        const data = await response.json() as Record<string, unknown>;
        const distTags = data['dist-tags'] as Record<string, string> | undefined;
        const latestVersion = distTags?.latest || 'unknown';
        const description = (data.description as string) || '';
        const readme = (data.readme as string) || '';

        // Condense README: take the first ~2000 chars which usually contains
        // installation, basic usage, and API overview
        const condensedReadme = condenseReadme(readme, packageName);

        return {
            name: packageName,
            version: latestVersion,
            description,
            readme: condensedReadme,
            fetchedAt: Date.now(),
        };
    } catch (error) {
        logger.warn(`Failed to fetch docs for ${packageName}:`, error);
        return null;
    }
}

/**
 * Condense a README to the most useful sections for code generation:
 * installation, quick start, basic usage, and API examples.
 */
function condenseReadme(readme: string, _packageName: string): string {
    if (!readme || readme.length < 50) return '';

    // Remove badges, images, and HTML tags
    let cleaned = readme
        .replace(/!\[.*?\]\(.*?\)/g, '')           // markdown images
        .replace(/<img[^>]*>/gi, '')                // HTML images
        .replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, '') // badge links
        .replace(/<\/?(?:p|div|span|br|hr)[^>]*>/gi, '\n') // basic HTML
        .replace(/<[^>]+>/g, '')                    // remaining HTML tags
        .trim();

    // Find the most useful sections
    const sections = cleaned.split(/^#{1,3}\s+/m);
    const usefulSections: string[] = [];
    const usefulHeaders = [
        'install', 'getting started', 'quick start', 'usage',
        'basic usage', 'example', 'api', 'features', 'setup',
    ];

    // Always include the intro (first section before any heading)
    if (sections[0] && sections[0].trim().length > 20) {
        usefulSections.push(sections[0].trim().slice(0, 500));
    }

    for (const section of sections.slice(1)) {
        const firstLine = section.split('\n')[0]?.toLowerCase() || '';
        if (usefulHeaders.some(h => firstLine.includes(h))) {
            usefulSections.push(section.trim().slice(0, 800));
        }
    }

    const result = usefulSections.join('\n\n').slice(0, 2000);
    return result || cleaned.slice(0, 1500);
}

/**
 * Fetch documentation for all frameworks listed in a blueprint.
 * Runs fetches in parallel with a concurrency limit.
 * Returns formatted documentation string for prompt injection.
 */
export async function fetchBlueprintDependencyDocs(
    frameworks: string[]
): Promise<string> {
    const packageNames = extractPackageNames(frameworks);

    if (packageNames.length === 0) {
        return '';
    }

    logger.info(`Fetching docs for ${packageNames.length} packages: ${packageNames.join(', ')}`);

    // Fetch all in parallel (npm registry is fast and rate-limit tolerant)
    const results = await Promise.allSettled(
        packageNames.map(name => fetchPackageDoc(name))
    );

    const docs: PackageDoc[] = results
        .filter((r): r is PromiseFulfilledResult<PackageDoc | null> => r.status === 'fulfilled')
        .map(r => r.value)
        .filter((d): d is PackageDoc => d !== null);

    if (docs.length === 0) {
        return '';
    }

    logger.info(`Successfully fetched docs for ${docs.length}/${packageNames.length} packages`);

    // Format for prompt injection
    const formatted = docs.map(doc => {
        const header = `### ${doc.name} v${doc.version}`;
        const desc = doc.description ? `${doc.description}\n` : '';
        return `${header}\n${desc}${doc.readme}`;
    }).join('\n\n---\n\n');

    return `<FETCHED DEPENDENCY DOCUMENTATION>
The following documentation was fetched from npm for this project's dependencies.
Use this as the authoritative reference for import patterns and API usage.

${formatted}
</FETCHED DEPENDENCY DOCUMENTATION>`;
}
