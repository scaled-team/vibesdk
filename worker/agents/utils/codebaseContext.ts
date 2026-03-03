import { FileOutputType } from "../schemas";

/** File extensions and paths that carry no useful context for code generation */
const EXCLUDED_PATTERNS = [
    'readme.md',
    '.bootstrap.js',
    'changelog.md',
    'license',
    'license.md',
    '.gitignore',
    '.npmrc',
    '.nvmrc',
    '.env.example',
    '.prettierrc',
    '.eslintignore',
];

/** Extensions that are config-only — redact contents but keep path visible */
const REDACTED_EXTENSIONS = [
    'wrangler.jsonc',
    'postcss.config.js',
    'postcss.config.cjs',
];

/** Config files the agent CAN see (important for import resolution and styling) */
// tsconfig.json — path aliases (@ imports)
// tailwind.config — custom theme, plugins, content paths
// vite.config — resolve aliases, plugins

/** Path segments that indicate non-essential directories */
const EXCLUDED_DIR_SEGMENTS = [
    '/dist/',
    '/build/',
    '/node_modules/',
    '/.git/',
    '/.next/',
    '/coverage/',
    '/__tests__/',
    '/.turbo/',
];

/** Asset file extensions — never useful as code context */
const ASSET_EXTENSIONS = [
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif',
    '.woff', '.woff2', '.ttf', '.eot',
    '.mp3', '.mp4', '.webm', '.ogg',
    '.zip', '.tar', '.gz',
];

export function getCodebaseContext(allFiles: FileOutputType[]): FileOutputType[] {
    return allFiles
        .filter(file => {
            const lowerPath = file.filePath.toLowerCase();

            // Exclude by exact filename match
            if (EXCLUDED_PATTERNS.some(p => lowerPath.endsWith(p))) return false;

            // Exclude by directory segment
            if (EXCLUDED_DIR_SEGMENTS.some(seg => lowerPath.includes(seg))) return false;

            // Exclude asset files
            if (ASSET_EXTENSIONS.some(ext => lowerPath.endsWith(ext))) return false;

            return true;
        })
        .map(file => {
            const lowerPath = file.filePath.toLowerCase();

            // Redact config files — keep path for imports/references but strip contents
            if (REDACTED_EXTENSIONS.some(ext => lowerPath.endsWith(ext))) {
                return { ...file, fileContents: '[CONFIG FILE — see package.json for dependencies]' };
            }

            // Redact lock files
            if (lowerPath.endsWith('package-lock.json') || lowerPath.endsWith('bun.lockb') || lowerPath.endsWith('yarn.lock') || lowerPath.endsWith('pnpm-lock.yaml')) {
                return { ...file, fileContents: '[LOCK FILE — redacted]' };
            }

            return file;
        });
}
