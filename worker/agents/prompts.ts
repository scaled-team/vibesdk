import { FileTreeNode, RuntimeError, StaticAnalysisResponse, TemplateDetails } from "../services/sandbox/sandboxTypes";
import { TemplateRegistry } from "./inferutils/schemaFormatters";
import z from 'zod';
import { PhasicBlueprint, AgenticBlueprint, BlueprintSchemaLite, AgenticBlueprintSchema, FileOutputType, PhaseConceptLiteSchema, PhaseConceptSchema, PhaseConceptType, TemplateSelection, Blueprint } from "./schemas";
import { IssueReport } from "./domain/values/IssueReport";
import { FileState, MAX_PHASES } from "./core/state";
import { CODE_SERIALIZERS, CodeSerializerType } from "./utils/codeSerializers";
import { getCodebaseContext } from "./utils/codebaseContext";

export const PROMPT_UTILS = {
    /**
     * Replace template variables in a prompt string
     * @param template The template string with {{variable}} placeholders
     * @param variables Object with variable name -> value mappings
     */
    replaceTemplateVariables(template: string, variables: Record<string, string>): string {
        let result = template;
        
        for (const [key, value] of Object.entries(variables)) {
            const placeholder = `{{${key}}}`;
            result = result.replaceAll(placeholder, value ?? '');
        }
        
        return result;
    },

    serializeTreeNodes(node: FileTreeNode): string {
        // The output starts with the root node's name.
        const outputParts: string[] = [node.path.split('/').pop() || node.path];
    
        function processChildren(children: FileTreeNode[], prefix: string) {
            children.forEach((child, index) => {
                const isLast = index === children.length - 1;
                const connector = isLast ? '└── ' : '├── ';
                const displayName = child.path.split('/').pop() || child.path;
    
                outputParts.push(prefix + connector + displayName);
    
                // If the child is a directory with its own children, recurse deeper.
                if (child.type === 'directory' && child.children && child.children.length > 0) {
                    // The prefix for the next level depends on whether the current node
                    // is the last in its list. This determines if we use a vertical line or a space.
                    const childPrefix = prefix + (isLast ? '    ' : '│   ');
                    processChildren(child.children, childPrefix);
                }
            });
        }
    
        // Start the process if the root node has children.
        if (node.children && node.children.length > 0) {
            processChildren(node.children, '');
        }
    
        return outputParts.join('\n');
    },

    serializeTemplate(template?: TemplateDetails): string {
        if (template) {
            return `
<TEMPLATE DETAILS>
The following are the details (structures and files) of the starting boilerplate template, on which the project is based.

Name: ${template.name}
Frameworks: ${template.frameworks?.join(', ')}

Template Usage Instructions: 
${template.description.usage}

<DO NOT TOUCH FILES>
These files are forbidden to be modified. Do not touch them under any circumstances. Doing so will break the application.
${(template.dontTouchFiles ?? []).join('\n')}
</DO NOT TOUCH FILES>

<REDACTED FILES>
These files are redacted. They exist but their contents are hidden for security reasons. Do not touch them under any circumstances.
${(template.redactedFiles ?? []).join('\n')}
</REDACTED FILES>

**Dynamic imports are not supported, so please avoid using them.**
${template.frameworks?.some(f => f.toLowerCase().includes('durable')) ? '**WebSockets are supported via Durable Objects in this template.**' : '**WebSockets are not natively supported in this template. Use polling or SSE for real-time features.**'}

</TEMPLATE DETAILS>`;
        } else {
            return `
<START_FROM_SCRATCH>
No starter template is available—design the entire structure yourself. You need to write all the configuration files, package.json, and all the source code files from scratch.
You are allowed to install stuff. Be very careful with the versions of libraries and frameworks you choose.
For an example typescript vite project,
The project should support the following commands in package.json to run the application:
"scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "npm run build && vite preview",
    "deploy": "npm run build && wrangler deploy",
    "cf-typegen": "wrangler types"
}
and provide a preview url for the application.

</START_FROM_SCRATCH>`;
        }
    },

    serializeErrors(errors: RuntimeError[]): string {
        if (errors && errors.length > 0) {
            const errorsSerialized = errors.map(e => {
                // Use rawOutput if available, otherwise serialize using schema
                const errorText = e.message;
                // Remove any trace lines with no 'tsx' or 'ts' extension in them
                const cleanedText = errorText.split('\n')
                                    .map(line => line.includes('/deps/') && !(line.includes('.tsx') || line.includes('.ts')) ? '' : line).filter(line => line.trim() !== '')
                                    .join('\n');
                // Truncate to 1000 characters to prevent context overflow
                return `<error>${cleanedText.slice(0, 1000)}</error>`;
            });
            return errorsSerialized.join('\n\n');
        } else {
            return 'N/A';
        }
    },

    serializeStaticAnalysis(staticAnalysis: StaticAnalysisResponse, maxIssues = 20): string {
        const formatIssues = (issues: typeof staticAnalysis.lint.issues): string => {
            if (issues.length === 0) {
                return 'No issues detected';
            }
            const limitedIssues = issues.slice(0, maxIssues);
            const formatted = limitedIssues.map(issue => 
                `- [${issue.severity}] ${issue.filePath}:${issue.line}:${issue.column} - ${issue.message} (${issue.ruleId})`
            ).join('\n');
            if (issues.length > maxIssues) {
                return `${formatted}\n... and ${issues.length - maxIssues} more issues (truncated)`;
            }
            return formatted;
        };

        const lintOutput = staticAnalysis.lint.rawOutput || formatIssues(staticAnalysis.lint.issues);
        const typecheckOutput = staticAnalysis.typecheck.rawOutput || formatIssues(staticAnalysis.typecheck.issues);
        
        return `**LINT ANALYSIS:**
${lintOutput}

**TYPE CHECK ANALYSIS:**
${typecheckOutput}`;
    },

    verifyPrompt(prompt: string): string {
        // Check for un-replaced template variables — these cause LLM confusion
        const match = prompt.match(/\{\{(\w+)\}\}/);
        if (match) {
            console.warn(`Prompt contains un-replaced variable: {{${match[1]}}}`);
        }
        return prompt;
    },

    serializeFiles(files: FileOutputType[], serializerType: CodeSerializerType): string {
        // Use scof format
        return CODE_SERIALIZERS[serializerType](files);
    },    
    
    summarizeFiles(files: FileState[], max = 120): string {
        const compact = files
            .slice(0, max)
            .map((file) => {
                const purpose = file.filePurpose ? ` — ${file.filePurpose}` : '';
                return `- ${file.filePath}${purpose}`;
            })
            .join('\n');

        const extra = files.length > max ? `\n...and ${files.length - max} more` : '';
        return compact + extra;
    },


    REACT_RENDER_LOOP_PREVENTION: `
<REACT_RENDER_LOOP_PREVENTION>
"Maximum update depth exceeded" or "Too many re-renders" = your code has an infinite loop. React aborts after ~50 nested updates.

## VALIDATION CHECKLIST (Run Before Submitting)
Search your code for these patterns. If found, rewrite immediately:
- \`useStore()\` without selector → CRASH
- \`useStore(s => s)\` returning entire store → CRASH
- \`useStore(s => ({\` or \`useStore(s => [\` → CRASH (object/array allocation)
- \`useStore(s => s.get\` or \`useStore(s => Object.\` → CRASH (function call in selector)
- \`useEffect(() => {\` without \`}, [\` → CRASH (missing dependency array)
- \`setState\` call outside useEffect/event handler → CRASH

## ZUSTAND STORE SELECTORS

### ONLY ALLOWED PATTERNS (use these exclusively):
\`\`\`tsx
// Direct property access - returns stable ref or primitive
const user = useStore(s => s.user);
const name = useStore(s => s.user.name);
const isOpen = useStore(s => s.isOpen);
const count = useStore(s => s.items.length);
const isValid = useStore(s => !!s.data);

// Multiple values? Call useStore multiple times:
const name = useStore(s => s.name);
const age = useStore(s => s.age);

// Need derived data? Derive OUTSIDE the selector with useMemo:
const items = useStore(s => s.items);
const sortedItems = useMemo(() => [...items].sort(), [items]);
\`\`\`

### BANNED ANTI-PATTERNS (never write these):
\`\`\`tsx
useStore()                              // no selector - returns entire store, new ref every time
useStore(s => s)                        // identity selector - same problem, returns entire store
useStore(s => ({ name: s.name }))       // object literal - allocates new object every render
useStore(s => [s.a, s.b])               // array literal - allocates new array every render
useStore(s => s.getItems())             // method call - may return new ref
useStore(s => Object.keys(s.data))      // Object.keys - allocates new array
useStore(s => s.items.filter(x => x))   // .filter/.map/.reduce - allocates new array
useStore(useShallow(s => ({ a: s.a }))) // useShallow doesn't fix object allocation
const { name, age } = useStore(s => s)  // destructuring entire store - still causes re-render
\`\`\`

## STATE UPDATES

### ALLOWED: Only in event handlers or useEffect
\`\`\`tsx
const handleClick = () => setCount(count + 1);     // event handler - OK
useEffect(() => { setData(result); }, [result]);   // useEffect - OK
\`\`\`

### BANNED: During render phase
\`\`\`tsx
function Component() {
    const [n, setN] = useState(0);
    setN(n + 1);                    // CRASH - setState during render
    if (condition) setX(value);     // CRASH - conditional setState during render
    return <div>{n}</div>;
}
\`\`\`

## useEffect RULES

### ALLOWED:
\`\`\`tsx
useEffect(() => { /* ... */ }, []);           // empty deps - run once
useEffect(() => { /* ... */ }, [userId]);     // specific deps
useEffect(() => {
    if (userId) fetchUser(userId);             // guard before async/setState
}, [userId]);
\`\`\`

### BANNED:
\`\`\`tsx
useEffect(() => { setCount(count + 1); });    // no dependency array - infinite loop
useEffect(() => { setX(y); }, [y, setX]);     // including setter that triggers itself
\`\`\`

## UNSTABLE REFERENCES

### Problem: New object/array created every render triggers useEffect infinitely
\`\`\`tsx
// BANNED:
const config = { theme: 'dark' };              // new object every render
useEffect(() => { init(config); }, [config]); // infinite loop

// ALLOWED:
const config = useMemo(() => ({ theme: 'dark' }), []);
useEffect(() => { init(config); }, [config]); // stable reference
\`\`\`

## QUICK RULES
1. Zustand selectors: return primitive or direct property access ONLY
2. setState: ONLY in useEffect or event handlers, NEVER during render
3. useEffect: ALWAYS include dependency array
4. Objects/arrays in deps: wrap with useMemo
5. Multiple store values: call useStore multiple times, don't destructure
6. Derived data: compute with useMemo OUTSIDE selector

</REACT_RENDER_LOOP_PREVENTION>`,

COMMON_PITFALLS: `<AVOID COMMON PITFALLS>
    **MISSION-CRITICAL RULES (FAILURE WILL CRASH THE APP):**
    1. **DEPENDENCY VALIDATION:** BEFORE writing any import, verify it exists in <DEPENDENCIES>. Use named imports where required (e.g. \`{ ReactFlow }\` from '@xyflow/react', \`{ cn }\` from '@/lib/utils'). Always use \`import X from 'pkg'\` syntax — never \`import X, 'pkg'\`.
    2. **IMPORT & EXPORT INTEGRITY:** Match default/named imports to exports. Import React in every TSX/JSX file. Use \`@/components/ui/[component]\` for shadcn. Use \`react-router-dom\` for routing (not Next.js). No \`require()\` or dynamic \`import()\`.
    3. **NO RUNTIME ERRORS:** Write fault-tolerant code. Use optional chaining (\`?.\`) and nullish coalescing (\`??\`). Wrap async operations in try-catch. Handle loading/error/empty states.
    4. **NO UNDEFINED VALUES:** All variables, functions, and components must be defined before use. If you use something, define or import it.
    5. **STATE UPDATE INTEGRITY:** Never call setState during render — only in useEffect or event handlers. All useEffect hooks MUST have dependency arrays. Zustand: \`useStore(s => s.field)\` ONLY — no object/array selectors, no whole-store destructuring. Multiple values = multiple useStore calls. Derived data = useMemo OUTSIDE selector.
    6. **VISUAL HIERARCHY:** Clear text hierarchy, interactive feedback on all clickable elements (hover/focus/active states), systematic spacing, proper loading/error states.

    **LAYOUT PITFALLS:**
    - h-full requires all parent elements to have explicit height. Root chain: html(100vh) -> body(h-full) -> #root(h-full) -> page(h-screen).
    - flex-1 only works when parent has className="flex". Use flex-col for columns.
    - Sidebars need min-w-[180px] on content, not %-based minimums.
    - Framer Motion: no dragHandle prop — use useDragControls + dragListener={false}.

    **TYPE SAFETY:**
    - Include all required fields for discriminated unions. Don't force types with \`as\` to skip required fields.
    - NEVER duplicate property names in object literals.
    - Use functional state updates: \`setCount(prev => prev + 1)\`

    **RELIABILITY:**
    - Handle loading/success/error states for all async operations. Initialize state with proper defaults.
    - Use error boundaries, conditional rendering, and stable unique keys for lists.
    - Use React.memo, useMemo, useCallback to prevent unnecessary re-renders.
    - For games/calculations: validate array bounds, use === for comparisons, break complex logic into small functions.
    - DRY: maximize code reuse, import existing types/components instead of redefining.

    **FRAMEWORK RULES:**
    - Follow Vite + React patterns (no Next.js-specific APIs). Verify Tailwind classes exist in config.
    - console.error and console.warn are wired to send reports to backend — add them in error-prone code paths.
    - Dynamic imports are not supported. Use static imports only.
    - Never write image files — use URLs from the web (unsplash, placehold.co, etc).
    - \`cloudflare:workers\` and \`cloudflare:durable-objects\` are pre-installed — do not add them as dependencies.
    - If a TS error says a component type is \`'typeof import(...)'\`, check named vs default import.

</AVOID COMMON PITFALLS>`,
    COMMON_DEP_DOCUMENTATION: `<COMMON DEPENDENCY DOCUMENTATION>

    **State Management:**
    - zustand v5: \`import { create } from 'zustand'\`. Selectors: \`useStore(s => s.field)\` ONLY. useShallow: \`import { useShallow } from 'zustand/react/shallow'\`. Store actions are stable — do NOT include in dependency arrays.
    - @tanstack/react-query v5: \`import { useQuery, useMutation, QueryClient, QueryClientProvider } from '@tanstack/react-query'\`. NOT \`react-query\` (old name).
    - immer v10: \`import { produce } from 'immer'\`. With zustand: \`import { immer } from 'zustand/middleware/immer'\`.

    **Routing:**
    - react-router v7: \`import { BrowserRouter, Routes, Route, useNavigate, useParams, Link, Outlet } from 'react-router'\`. v7 uses \`react-router\` not \`react-router-dom\`.
    - react-router v6: \`import { ... } from 'react-router-dom'\`. Check template to determine version.

    **UI Components:**
    - @radix-ui/*: Each primitive is separate. \`import * as Dialog from '@radix-ui/react-dialog'\`. Use namespace import.
    - shadcn/ui: Import from \`@/components/ui/[component]\`. Pre-installed in templates.
    - lucide-react: \`import { Search, Menu, X } from 'lucide-react'\`. PascalCase named exports.
    - framer-motion v11+: \`import { motion, AnimatePresence } from 'framer-motion'\`. No dragHandle prop — use useDragControls.
    - cmdk: \`import { Command } from 'cmdk'\`. Default export.

    **Data Visualization:**
    - recharts v2: \`import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'\`. Named exports.
    - @xyflow/react v12: Named exports ONLY — \`import { ReactFlow, Handle, Position } from '@xyflow/react'\`. Default import causes runtime crash.
    - d3-scale: \`import { scaleLinear, scaleOrdinal } from 'd3-scale'\`. NOT d3-scale-chromatic (color schemes only).

    **Forms & Validation:**
    - react-hook-form v7: \`import { useForm, Controller } from 'react-hook-form'\`.
    - zod: \`import { z } from 'zod'\`. With RHF: \`import { zodResolver } from '@hookform/resolvers/zod'\`.

    **Date & Time:**
    - date-fns v3: \`import { format, parseISO } from 'date-fns'\`. Tree-shakeable named exports.
    - dayjs v1: \`import dayjs from 'dayjs'\`. Default export.

    **Utilities:**
    - clsx: \`import { clsx } from 'clsx'\`. Named export (NOT default).
    - tailwind-merge: \`import { twMerge } from 'tailwind-merge'\`. Combined as cn(): \`import { cn } from '@/lib/utils'\`.

    **Payments:**
    - @stripe/stripe-js: \`import { loadStripe } from '@stripe/stripe-js'\`. Call once: \`const stripePromise = loadStripe('pk_test_PLACEHOLDER')\`.
    - @stripe/react-stripe-js: \`import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'\`. Wrap in \`<Elements stripe={stripePromise}>\`.

    **Auth:**
    - @clerk/clerk-react: \`import { ClerkProvider, SignIn, useUser } from '@clerk/clerk-react'\`.
    - @supabase/supabase-js: \`import { createClient } from '@supabase/supabase-js'\`.

    **3D:**
    - @react-three/fiber ^9 and @react-three/drei ^10 require React 19. With React 18: "Cannot read properties of undefined (reading 'S')".

    **Markdown & Toast:**
    - react-markdown v9: \`import ReactMarkdown from 'react-markdown'\`. Default export.
    - sonner: \`import { toast, Toaster } from 'sonner'\`. Add \`<Toaster />\` to root layout.

    **GENERAL RULES:**
    - Dynamic imports (\`import()\`) and \`require()\` are NOT supported. Static imports only.
    - \`cloudflare:workers\` and \`cloudflare:durable-objects\` are pre-installed — never add as dependencies.
    - When unsure about a package API, use the web_search tool to look up documentation.
</COMMON DEPENDENCY DOCUMENTATION>
`,
    COMMANDS: `<SETUP COMMANDS>
    • **Provide explicit commands to install necessary dependencies ONLY.** DO NOT SUGGEST MANUAL CHANGES. These commands execute directly.
    • **Dependency Versioning:**
        - **Use specific, known-good major versions.** Avoid relying solely on 'latest' (unless you are unsure) which can introduce unexpected breaking changes.
        - Always suggest a known recent compatible stable major version. If unsure which version might be available, don't specify any version.
        - Example: \`bun add react@19 react-dom@19\`
        - List commands to add dependencies separately, one command per dependency for clarity.
        - Make sure the packages actually exist and are correct.
    • **Format:** Provide ONLY the raw command(s) without comments, explanations, or step numbers, in the form of a list
    • **Execution:** These run *before* code generation begins.

Example:
\`\`\`sh
bun add react@19
bun add react-dom@19
bun add zustand@5
bun add immer@10
\`\`\`
</SETUP COMMANDS>
`,
    CODE_CONTENT_FORMAT: `<CODE CONTENT GENERATION RULES> 
    The generated content for any file should be one of the following formats: \`full_content\` or \`unified_diff\`.

    - **When working on an existing (previously generated) file and the scope of changes would be smaller than a unified diff, use \`unified_diff\` format.**
    - **When writing an entirely new file, or the scope of changes would be bigger than a unified diff, use \`full_content\` format.**
    - **Do not use \`unified_diff\` for modifying untouched template files.**
    - **Make sure to choose the format so as to minimize the total length of response.**

    <RULES FOR \`full_content\`>
        • **Content Format:** Provide the complete and raw content of the file. Do not escape or wrap the content in any way.
        • **Example:**
            \`\`\`
                function myFunction() {
                    console.log('Hello, world!');
                }
            \`\`\`
    </RULES FOR \`full_content\`>

    <RULES FOR \`unified_diff\`>
        • **Content Format:** Provide the diff of the file. Do not escape or wrap the content in any way.
        • **Usage:** Use this format when working to modify an existing file and it would be smaller to represent the diff than the full content.
        
        **Diff Format Rules:**
            • Return edits similar to diffs that \`diff -U0\` would produce.
            • Do not include the first 2 lines with the file paths.
            • Start each hunk of changes with a \`@@ ... @@\` line.
            • Do not include line numbers like \`diff -U0\` does. The user's patch tool doesn't need them. The user's patch tool needs CORRECT patches that apply cleanly against the current contents of the file!
            • Think carefully and make sure you include and mark all lines that need to be removed or changed as \`-\` lines.
            • Make sure you mark all new or modified lines with \`+\`.
            • Don't leave out any lines or the diff patch won't apply correctly.
            • Indentation matters in the diffs!
            • Start a new hunk for each section of the file that needs changes.
            • Only output hunks that specify changes with \`+\` or \`-\` lines.
            • Skip any hunks that are entirely unchanging \` \` lines.
            • Output hunks in whatever order makes the most sense. Hunks don't need to be in any particular order.
            • When editing a function, method, loop, etc try to use a hunk to replace the *entire* code block. Delete the entire existing version with \`-\` lines and then add a new, updated version with \`+\` lines.  This will help you generate correct code and correct diffs.
            • To move code within a file, use 2 hunks: 1 to delete it from its current location, 1 to insert it in the new location.
        **Example:**

** Instead of low level diffs like this: **
\`\`\`
@@ ... @@
-def factorial(n):
+def factorial(number):
-    if n == 0:
+    if number == 0:
         return 1
     else:
-        return n * factorial(n-1)
+        return number * factorial(number-1)
\`\`\`

**Write high level diffs like this:**

\`\`\`
@@ ... @@
-def factorial(n):
-    if n == 0:
-        return 1
-    else:
-        return n * factorial(n-1)
+def factorial(number):
+    if number == 0:
+        return 1
+    else:
+        return number * factorial(number-1)
\`\`\`

    </RULES FOR \`unified_diff\`>

    When a changes to a file are big or the file itself is small, it is better to use \`full_content\` format, otherwise use \`unified_diff\` format. In the end, you should choose a format that minimizes the total length of response.
</CODE CONTENT GENERATION RULES>
`,
    UI_GUIDELINES: `## UI DESIGN STANDARDS

    **Typography:** Use clear hierarchy — text-4xl+ font-bold for headlines, text-2xl font-semibold for subheads, text-base for body, text-sm for captions. Primary text: text-gray-900, secondary: text-gray-600, tertiary: text-gray-400.

    **Spacing:** Systematic rhythm using space-y-16/24 for sections, space-y-6/8 for content blocks, space-y-3/4 for tight groups. Use 8px base unit.

    **Interactivity:** All interactive elements need hover (hover:shadow-lg, hover:bg-*-600), focus (focus:ring-2 focus:ring-offset-2), active (active:scale-95) states. Add transition-all duration-200 ease-in-out to state changes. Every async operation needs loading states (spinners, skeleton screens).

    **Layout:** Containers: max-w-7xl mx-auto px-4 sm:px-6 lg:px-8. Grids: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 with gap-6. Cards: shadow-sm/md with p-6, hover:shadow-xl hover:-translate-y-1.

    **Responsive:** Mobile-first. Touch targets min 44px. Scale typography: text-2xl md:text-4xl lg:text-5xl. Use sm/md/lg/xl breakpoints intentionally.

    **Polish:** Consistent spacing rhythm, proper color contrast (>=4.5:1), beautiful loading/error/empty states, smooth 60fps animations.`,
    UI_NON_NEGOTIABLES_V3: `## UI NON-NEGOTIABLES (Tailwind v3-safe, shadcn/ui first)

1) Root Wrapper & Gutters (copy exactly)
export default function Page() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="py-8 md:py-10 lg:py-12">
        {/* content */}
      </div>
    </div>
  );
}

2) Prefer shadcn/ui components heavily
- Use shadcn/ui primitives for structure and widgets (e.g., Button, Card, Input, Sheet, Sidebar)
- Import from "@/components/ui/..." and compose with Tailwind utilities. Use Radix primitives as needed for composition.

3) Tailwind v3-safe Instructions
- Avoid CSS @theme or CSS @plugin directives in component styles
- Prefer built-in utilities only; avoid plugin-only utilities unless template shows they exist
- For media sizing, prefer aspect-video or aspect-[16/9] and object-cover

4) Good vs Bad
- BAD: top-level <div> with no gutters (content flush to the left edge)
- GOOD: wrap with max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 and section spacing py-8 md:py-10 lg:py-12

5) Color & Contrast (light theme defaults)
- Primary labels: text-foreground
- Secondary/meta: text-muted-foreground
- Selected state: bg-accent text-accent-foreground (or bg-primary text-primary-foreground)
- Icons: text-foreground/80 hover:text-foreground
- Inputs: bg-secondary text-secondary-foreground border border-input; placeholder:text-muted-foreground
- Never place muted text over dark backgrounds; if background is dark, use paired *-foreground or text-white
- Aim for >= 4.5:1 contrast for normal text (>= 3:1 for large)
`,
PROJECT_CONTEXT: `Here is everything you will need about the project:

<PROJECT_CONTEXT>

{{phasesText}}

<CODEBASE>

Here are all the latest relevant files in the current codebase:

{{files}}

**THESE DO NOT INCLUDE PREINSTALLED SHADCN COMPONENTS, REDACTED FOR SIMPLICITY. BUT THEY DO EXIST AND YOU CAN USE THEM.**

<FILE_TREE>
**Use these files as a reference for the file structure, components and hooks that are present**

{{fileTree}}

</FILE_TREE>

</CODEBASE>

{{commandsHistory}}

</PROJECT_CONTEXT>
`,
}

/*

<LAST_DIFFS>
These are the changes that have been made to the codebase since the last phase:

{{lastDiffs}}

</LAST_DIFFS>
*/

export const STRATEGIES_UTILS = {
    INITIAL_PHASE_GUIDELINES: `**First Phase: Frontend Foundation & Core Functionality**
        * **Design Foundation:** Establish color palette, typography scale, spacing rhythm. Leverage shadcn components for cohesive UI. Build navigation, headers, footers with proper layout.
        * **UI Components:** All interactive elements need hover/focus/active states and smooth transitions. Handle loading, error, and empty states. Responsive at all breakpoints.
        * **Frontend Completion:** Primary page fully functional. Secondary pages with working navigation (zero broken links). Clear visual hierarchy and information architecture.
        * **Core Functionality:** Implement core application logic with proper error handling. Clean data presentation. Smooth user workflows.
        * **Responsive:** Mobile-first with proper touch targets. Intentional design at every breakpoint.
        * **Phase Granularity:** Simple apps = complete product in one phase. Complex apps = strong foundation that impresses immediately.
        * **Deployable Milestone:** First phase must be immediately demoable.
        * **Override template home page:** Rewrite the home page — do not remove, rewrite on top of it.`,
    SUBSEQUENT_PHASE_GUIDELINES: `**Subsequent Phases: Feature Completion & Polish**
        * **Iterative Refinement:** Each phase refines spacing, animations, and interactions. Improve components to professional grade. Streamline workflows and eliminate friction.
        * **Feature Implementation:** Complete all requested features with polished UI. Smooth user journeys, beautiful data visualizations, effortless forms and modals.
        * **Backend Integration:** Proper loading indicators, friendly error messages, graceful empty/error/loading states. Fast, responsive data transitions.
        * **Scalability:** Expand design system with reusable components. Establish consistent interaction patterns.
        * **Final Phase Standards:** Production-ready code. Fast load times. Cross-browser compatibility. Every interaction polished.
        * **Always deliver all features within scope.**`,
    CODING_GUIDELINES: `**Make sure the product is **FUNCTIONAL** along with **POLISHED**
    **MAKE SURE TO NOT BREAK THE APPLICATION in SUBSEQUENT PHASES. Always keep fallbacks and failsafes in place for any backend interactions. Look out for simple syntax errors and dependencies you use!**
    **The client needs to be provided with a good demoable application after each phase. The initial first phase is the most impressionable phase! Make sure it deploys and renders well.**
    **Make sure the primary (home) page is rendered correctly and as expected after each phase**
    **Make sure to overwrite the home page file**`,
    CONSTRAINTS: `<PHASE GENERATION CONSTRAINTS>
        **Focus on building the frontend and all the views/pages in the initial 1-2 phases with core functionality and mostly mock data, then fleshing out the application**    
        **Before writing any components of your own, make sure to check the existing components and files in the template, try to use them if possible (for example preinstalled shadcn components)**
        **If auth functionality is required: Use real auth SDKs (e.g. Clerk, Auth0, NextAuth, Supabase Auth) with placeholder API keys when the user requests a specific provider. Fall back to mock auth with prefilled credentials when no provider is specified or the template lacks a persistence layer. Always seed mock data and prefill UI with test credentials for demo purposes.**

        **Applications with single view/page or mostly static content are considered **Simple Projects** and those with multiple views/pages are considered **Complex Projects** and should be designed accordingly.**
        * **Phase Count:** Aim for a maximum of 1 phase for simple applications and 3-7 phases for complex applications. Each phase should be self-contained. Do not exceed more than ${Math.floor(MAX_PHASES * 0.8)} phases unless addressing complex client requirements or feedbacks.
        * **File Count:** Aim for a maximum of 1-3 files per phase when each file is big and self-container, or 8-12 files per phase when most files are small (< 100 lines).
        * The number of files in the project should be proportional to the number of views/pages that the project has.
        * Keep the size of codebase as small as possible, write encapsulated and abstracted code that can be reused, maximize code and component reuse and modularity. If a function/component is to be used in multiple files, it should be defined in a shared file.
        **DO NOT WRITE/MODIFY README FILES, LICENSES, ESSENTIAL CONFIG, OR OTHER NON-APPLICATION FILES as they are already configured in the final deployment. You are allowed to modify tailwind.config.js, vite.config.js etc if necessary**
            - Be very careful while working on vite.config.js, tailwind.config.js, etc. as any wrong changes can break the application.
        **DO NOT WRITE pdf files, images, or any other non-text files as they are not supported by the deployment.**

        **Examples**:
            * Building any tic-tac-toe game: Has a single page, simple logic -> **Simple Project** - 1 phase and 1-2 files that contain most of the code. Initial phase should yield a perfectly working game.        
            * Building any themed 2048 game: Has a single page, simple logic -> **Simple Project** - 1 phase and 2 files max that contain most of the code. Initial phase should yield a perfectly working game.
            * Building a full chess platform: Has multiple pages -> **Complex Project** - 3-5 phases and 5-15 files, with initial phase having around 5-11 files and should have the primary homepage working with mockups for all other views.
            * Building a full e-commerce platform: Has multiple pages -> **Complex Project** - 3-5 phases and 5-15 files max, with initial phase having around 5-11 files and should have the primary homepage working with mockups for all other views.
            * Building a minecraft clone: Has complex 3d rendering and multiple views -> **Complex Project** - 5-7 phases and 10-20 files max

        <TRUST & SAFETY POLICIES>
        • **NEVER** provide any code that can be used to perform nefarious/malicious activities.
        • **If a user asks to build a clone or look-alike of a popular product or service, alter the name and description, and explicitly add a visible disclaimer that it is a clone or look-alike to avoid phishing concerns.**
        • **NEVER** Let users build applications for phishing or malicious purposes.
        </TRUST & SAFETY POLICIES>
    </PHASE GENERATION CONSTRAINTS>`,
}

export const STRATEGIES = {
    FRONTEND_FIRST_PLANNING: `<PHASES GENERATION STRATEGY>
    **STRATEGY: Scalable, Demoable Frontend and core application First / Iterative Feature Addition later**
    The project would be developed live: The user (client) would be provided a preview link after each phase. This is our rapid development and delivery paradigm.
    The core principle is to establish a visually complete and polished frontend presentation early on with core functionalities implemented, before layering in more advanced functionality and fleshing out the backend.
    The goal is to build and demo a functional and beautiful product as fast and as early as possible.
    **Each phase should be self-contained, deployable and demoable.**
    The number of phases and files per phase should scale based on the number of views/pages and complexity of the application, layed out as follows:

    ${STRATEGIES_UTILS.INITIAL_PHASE_GUIDELINES}

    ${STRATEGIES_UTILS.SUBSEQUENT_PHASE_GUIDELINES}

    ${STRATEGIES_UTILS.CONSTRAINTS}

    **Use semantic HTML elements (nav, main, section, article, button) for free accessibility. Do not spend time on ARIA labels or keyboard navigation unless requested. Focus on delivering a working, polished application in as few phases as possible.**
    **Always stick to existing project/template patterns. Respect and work with existing worker bindings rather than making custom ones**
    **Use the best tools and libraries for the job, including third-party SDKs that require API keys. When API keys are needed, use placeholder test keys (e.g. \`pk_test_PLACEHOLDER\`) or environment variable references. The user will configure real credentials after export. Refer to template usage instructions to know if specific cloudflare services are also available for use.**
    **Make sure to implement all the features and functionality requested by the user. Stick to the blueprint's implementation roadmap and end at the conclusion of the final phase. There should be no compromises**
    **This is a Cloudflare Workers & Durable Objects project. The environment is preconfigured. Absolutely DO NOT Propose changes to wrangler.toml or any other config files. These config files are hidden from you but they do exist.**
    **The Homepage of the frontend is a dummy page. It should be rewritten as the primary page of the application in the initial phase.**
    **Refrain from editing any of the 'dont touch' files in the project, e.g - package.json, vite.config.ts, wrangler.jsonc, etc.**
</PHASES GENERATION STRATEGY>`, 
FRONTEND_FIRST_CODING: `<PHASES GENERATION STRATEGY>
    **STRATEGY: Scalable, Demoable Frontend and core application First / Iterative Feature Addition later**
    The project would be developed live: The user (client) would be provided a preview link after each phase. This is our rapid development and delivery paradigm.
    The core principle is to establish a visually complete and polished frontend presentation early on with core functionalities implemented, before layering in more advanced functionality and fleshing out the backend.
    The goal is to build and demo a functional and beautiful product as fast and as early as possible.
    **Each phase should be self-contained, deployable and demoable**

    ${STRATEGIES_UTILS.INITIAL_PHASE_GUIDELINES}

    ${STRATEGIES_UTILS.SUBSEQUENT_PHASE_GUIDELINES}

    ${STRATEGIES_UTILS.CODING_GUIDELINES}

    **Make sure to implement all the features and functionality requested by the user and more. The application should be fully complete by the end of the last phase. There should be no compromises**
</PHASES GENERATION STRATEGY>`, 
}

export interface GeneralSystemPromptBuilderParams {
    query: string,
    templateDetails?: TemplateDetails,
    dependencies?: Record<string, string>,
    blueprint?: Blueprint,
    language?: string,
    frameworks?: string[],
    templateMetaInfo?: TemplateSelection,
    fetchedDepDocs?: string,
}

export function generalSystemPromptBuilder(
    prompt: string,
    params: GeneralSystemPromptBuilderParams
): string {
    // Base variables always present
    const variables: Record<string, string> = {
        query: params.query,
    };
    
    // Template context (optional)
    if (params.templateDetails) {
        variables.template = PROMPT_UTILS.serializeTemplate(params.templateDetails);
        variables.dependencies = JSON.stringify(params.dependencies ?? {});
    }

    // Blueprint variables - discriminate by type
    if (params.blueprint) {
        if ('implementationRoadmap' in params.blueprint) {
            // Phasic blueprint
            const phasicBlueprint = params.blueprint as PhasicBlueprint;
            const blueprintForPrompt = { ...phasicBlueprint, initialPhase: undefined };
            variables.blueprint = TemplateRegistry.markdown.serialize(blueprintForPrompt, BlueprintSchemaLite);
            variables.blueprintDependencies = phasicBlueprint.frameworks?.join(', ') ?? '';
        } else {
            // Agentic blueprint
            const agenticBlueprint = params.blueprint as AgenticBlueprint;
            variables.blueprint = TemplateRegistry.markdown.serialize(agenticBlueprint, AgenticBlueprintSchema);
            variables.blueprintDependencies = agenticBlueprint.frameworks?.join(', ') ?? '';
            variables.agenticPlan = agenticBlueprint.plan.map((step, i) => `${i + 1}. ${step}`).join('\n');
        }
    }

    // Optional language and frameworks
    if (params.language) {
        variables.language = params.language;
    }
    if (params.frameworks) {
        variables.frameworks = params.frameworks.join(', ');
    }
    if (params.templateMetaInfo) {
        variables.usecaseSpecificInstructions = getUsecaseSpecificInstructions(params.templateMetaInfo);
    }

    // Inject pre-fetched dependency docs (empty string if not available)
    variables.fetchedDepDocs = params.fetchedDepDocs || '';

    const formattedPrompt = PROMPT_UTILS.replaceTemplateVariables(prompt, variables);
    return PROMPT_UTILS.verifyPrompt(formattedPrompt);
}

export function issuesPromptFormatter(issues: IssueReport): string {
    const runtimeErrorsText = PROMPT_UTILS.serializeErrors(issues.runtimeErrors);
    const staticAnalysisText = PROMPT_UTILS.serializeStaticAnalysis(issues.staticAnalysis);
    
    return `## ERROR ANALYSIS PRIORITY MATRIX

### 1. CRITICAL RUNTIME ERRORS (Fix First - Deployment Blockers)
**Error Count:** ${issues.runtimeErrors?.length || 0} runtime errors detected
**Contains Render Loops:** ${runtimeErrorsText.includes('Maximum update depth') || runtimeErrorsText.includes('Too many re-renders') || runtimeErrorsText.includes('infinite loop') ? 'YES - HIGHEST PRIORITY' : 'No'}

${runtimeErrorsText || 'No runtime errors detected'}

### 2. STATIC ANALYSIS ISSUES (Fix After Runtime Issues)
**Lint Issues:** ${issues.staticAnalysis?.lint?.issues?.length || 0}
**Type Issues:** ${issues.staticAnalysis?.typecheck?.issues?.length || 0}

${staticAnalysisText}

## ANALYSIS INSTRUCTIONS
- **PRIORITIZE** "Maximum update depth exceeded" and useEffect-related errors. If 'Warning: The result of getSnapshot should be cached to avoid an infinite loop' is present, it is a high priority issue to be resolved ASAP. 
- **CROSS-REFERENCE** error messages with current code structure (line numbers may be outdated)
- **VALIDATE** reported issues against actual code patterns before fixing
- **FOCUS** on deployment-blocking runtime errors over linting issues`
}

const COMPLETED_PHASES_CONTEXT = `
<COMPLETED_PHASES>

The following phases have been completed and implemented:

{{redactionNotice}}

{{phases}}

</COMPLETED_PHASES>`

/**
 * Compact code for context injection: reduce indentation and strip noise comments.
 * Only used for PROJECT_CONTEXT (read-only context), NOT for code fixer diffs.
 */
function compactCodeForContext(content: string): string {
    let result = content.replace(/^( {4})+/gm, (match) =>
        '  '.repeat(match.length / 4),
    );
    result = result.replace(/^\s*\/\/(?!\s*(TODO|FIXME|HACK|@)).*$/gm, '');
    result = result.replace(/\n{3,}/g, '\n\n');
    return result.trim();
}

/**
 * Budget-based file selection: send full contents for high-priority files
 * within a character budget, summarize the rest.
 * Priority: recently changed (has lastDiff) > small files > large files
 */
const MAX_FULL_CONTENT_CHARS = 80_000; // ~20K tokens budget for file contents

function selectFilesWithBudget(
    files: FileOutputType[],
    serializerType: CodeSerializerType
): string {
    if (files.length === 0) return '';

    // FileState extends FileOutputType with lastDiff — check safely
    const hasLastDiff = (f: FileOutputType): boolean =>
        'lastDiff' in f && !!(f as FileState).lastDiff;

    const sorted = [...files].sort((a, b) => {
        const aDiff = hasLastDiff(a) ? 1 : 0;
        const bDiff = hasLastDiff(b) ? 1 : 0;
        if (aDiff !== bDiff) return bDiff - aDiff;
        return (a.fileContents?.length ?? 0) - (b.fileContents?.length ?? 0);
    });

    const fullContentFiles: FileOutputType[] = [];
    const summaryFiles: FileOutputType[] = [];
    let budget = MAX_FULL_CONTENT_CHARS;

    for (const file of sorted) {
        const size = file.fileContents?.length ?? 0;
        if (budget >= size && size > 0) {
            fullContentFiles.push({
                ...file,
                fileContents: compactCodeForContext(file.fileContents ?? ''),
            });
            budget -= size;
        } else {
            summaryFiles.push(file);
        }
    }

    let result = '';
    if (fullContentFiles.length > 0) {
        result += PROMPT_UTILS.serializeFiles(fullContentFiles, serializerType);
    }
    if (summaryFiles.length > 0) {
        result += `\n\n<ADDITIONAL_FILES count="${summaryFiles.length}">\nThe following files also exist in the project (contents omitted for brevity — use file tree for structure):\n`;
        result += summaryFiles
            .map(f => `- ${f.filePath}${f.filePurpose ? ` — ${f.filePurpose}` : ''}`)
            .join('\n');
        result += '\n</ADDITIONAL_FILES>';
    }

    return result;
}

export const USER_PROMPT_FORMATTER = {
    PROJECT_CONTEXT: (phases: PhaseConceptType[], files: FileState[], fileTree: FileTreeNode, commandsHistory: string[], serializerType: CodeSerializerType = CodeSerializerType.SIMPLE) => {
        let lastPhaseFilesDiff = '';
        let phasesText = '';
        try {
            if (phases.length > 1) {
                const lastPhase = phases[phases.length - 1];
                if (lastPhase && lastPhase.files) {
                    // Get last phase files diff only
                    const fileMap = new Map<string, FileState>();
                    files.forEach((file) => fileMap.set(file.filePath, file));
                    const lastPhaseFiles = lastPhase.files.map((file) => fileMap.get(file.path)).filter((file) => file !== undefined);
                    lastPhaseFilesDiff = lastPhaseFiles.map((file) => file.lastDiff).join('\n');

                    // Set lastPhase = false for all phases but the last
                    phases.forEach((phase) => {
                        if (phase !== lastPhase) {
                            phase.lastPhase = false;
                        }
                    });
                }

                // Split phases into older (redacted) and last
                const olderPhases = phases.slice(0, -1);

                // Serialize older phases without files, recent phases with files
                if (olderPhases.length > 0) {
                    const olderPhasesLite = olderPhases.map(({ name, description }) => ({ name, description }));
                    phasesText += TemplateRegistry.markdown.serialize({ phases: olderPhasesLite }, z.object({ phases: z.array(PhaseConceptLiteSchema) }));
                }
                phasesText += '\n\nLast Phase Implemented:\n' + TemplateRegistry.markdown.serialize(lastPhase, PhaseConceptSchema);

                const redactionNotice = olderPhases.length > 0
                    ? `**Note:** File details for the first ${olderPhases.length} phase(s) have been redacted to optimize context. Only the last phase includes complete file information.\n`
                    : '';

                phasesText = COMPLETED_PHASES_CONTEXT.replaceAll('{{phases}}', phasesText).replaceAll('{{redactionNotice}}', redactionNotice);
            }
        } catch (error) {
            console.error('Error processing project context:', error);
        }

        const relevantFiles = getCodebaseContext(files);

        const variables: Record<string, string> = {
            phasesText: phasesText,
            files: selectFilesWithBudget(relevantFiles, serializerType),
            fileTree: PROMPT_UTILS.serializeTreeNodes(fileTree),
            lastDiffs: lastPhaseFilesDiff,
            commandsHistory: commandsHistory.length > 0 ? `<COMMANDS HISTORY>\n\nThe following commands have been executed successfully in the project environment so far (These may not include the ones that are currently pending):\n\n${commandsHistory.join('\n')}\n\n</COMMANDS HISTORY>` : ''
        };

        const prompt = PROMPT_UTILS.replaceTemplateVariables(PROMPT_UTILS.PROJECT_CONTEXT, variables);

        return PROMPT_UTILS.verifyPrompt(prompt);
    },
};

const getStyleInstructions = (style: TemplateSelection['styleSelection']): string => {
    switch (style) {
        case `Brutalism`:
            return `
**Style Name: Brutalism**
- Characteristics: Raw aesthetics, often with bold vibrant colors on light background, large typography, large elements.
- Philosophy: Emphasizes honesty and simplicity, Non-grid, asymmetrical layouts that ignore traditional design hierarchy.
- Example Elements: Large, blocky layouts, heavy use of whitespace, unconventional navigation patterns.
`;
        case 'Retro':
            return `
**Style Name: Retro**
- Characteristics: Early-Internet graphics, pixel art, 3D objects, or glitch effects.
- Philosophy: Nostalgia-driven, aiming to evoke the look and feel of 90s or early 2000s web culture.
- Example Elements: Neon palettes, grainy textures, gradient meshes, and quirky fonts.`;
        case 'Illustrative':
            return `
**Style Name: Illustrative**
- Characteristics: Custom illustrations, sketchy graphics, and playful elements
- Philosophy: Human-centered, whimsical, and expressive.
- Example Elements: Cartoon-style characters, brushstroke fonts, animated SVGs.
- Heading Font options: Playfair Display, Fredericka the Great, Great Vibes
            `
//         case 'Neumorphism':
//             return `
// **Style Name: Neumorphism (Soft UI)**
// - Use a soft pastel background, high-contrast accent colors for functional elements e.g. navy, coral, or bright blue. Avoid monochrome UIs
// - Light shadow (top-left) and dark shadow (bottom-right) to simulate extrusion or embedding, Keep shadows subtle but visible to prevent a washed-out look.
// - Avoid excessive transparency in text — keep readability high.
// - Integrate glassmorphism subtly`;
        case `Kid_Playful`:
            return `
**Style Name: Kid Playful**
- Bright, contrasting colors
- Stylized illustrations resembling 2D animation or children's book art
- Smooth, rounded shapes and clean borders—no gradients or realism
- Similar to Pablo Stanley, Burnt Toast Creative, or Outline-style art.
- Children's book meets modern web`
        case 'Minimalist Design':
            return `
**Style Name: Minimalist Design**
Characteristics: Clean layouts, lots of white space, limited color palettes, and simple typography.
Philosophy: "Less is more." Focuses on clarity and usability.
Example Elements: Monochrome schemes, subtle animations, grid-based layouts.
** Apply a gradient background or subtle textures to the hero section for depth and warmth.
`
    }
    return `
** Apply a gradient background or subtle textures to the hero section for depth and warmth.
** Choose a modern sans-serif font like Inter, Sora, or DM Sans
** Use visual contrast: white or light background, or very soft gradient + clean black text.
    `
};

const SAAS_LANDING_INSTRUCTIONS = (style: TemplateSelection['styleSelection']): string => `
** If there is no brand/product name specified, come up with a suitable name
** Include a prominent hero section with a headline, subheadline, and a clear call-to-action (CTA) button above the fold.
** Insert a pricing table with tiered plans if applicable
** Design a footer with key navigation links, company info, social icons, and a newsletter sign-up.
** Add a product feature section using icon-text pairs or cards to showcase 3-6 key benefits.
** Use a clean, modern layout with generous white space and a clear visual hierarchy
** Show the magic live i.e if possible show a small demo of the product. Only if simple and feasible.
** Generate SVG illustrations where absolutely relevant.

Use the following artistic style:
${getStyleInstructions(style)}
`;

const ECOMM_INSTRUCTIONS = (): string => `
** If there is no brand/product name specified, come up with a suitable name
** Include a prominent hero section with a headline, subheadline, and a clear call-to-action (CTA) button above the fold.
** Insert a product showcase section with high-quality images, descriptions, and prices.
** Provide a collapsible sidebar (desktop) or an expandable top bar (tablet/mobile) containing filters (category, price range slider, brand, color swatches), so users can refine results without leaving the page.
** Use a clean, modern layout with generous white space and a clear visual hierarchy
`;

const DASHBOARD_INSTRUCTIONS = (): string => `
** If applicable to user query group Related Controls and Forms into Well-Labeled Cards / Panels
** If applicable to user query offer Quick Actions / Shortcuts for Common Tasks
** If user asked for analytics/visualizations/statistics - Show sparklines, mini line/bar charts, or simple pie indicators for trends 
** If user asked for analytics/visualizations/statistics - Maybe show key metrics in modular cards
** If applicable to user query make It Interactive and Contextual (Filters, Search, Pagination)
** If applicable to user query add a sidebar and or tabs
** Dashboard should be information dense.
`;

export const getUsecaseSpecificInstructions = (selectedTemplate: TemplateSelection): string => {
    switch (selectedTemplate.useCase) {
        case 'SaaS Product Website':
            return SAAS_LANDING_INSTRUCTIONS(selectedTemplate.styleSelection);
        case 'E-Commerce':
            return ECOMM_INSTRUCTIONS();
        case 'Dashboard':
            return DASHBOARD_INSTRUCTIONS();
        default:
            return `Use the following artistic style:
            ${getStyleInstructions(selectedTemplate.styleSelection)}`;
    }
}
