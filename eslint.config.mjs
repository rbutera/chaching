import nx from '@nx/eslint-plugin';
import parser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';
import boundaries, { layers } from './tools/eslint-boundaries.mjs';
export default [
 { linterOptions: { reportUnusedDisableDirectives: false } },
 { ignores:['**/node_modules/**','**/dist/**','**/build/**','**/.svelte-kit/**','**/assets/**','.nx/**'] },
 { files:['packages/**/*.{ts,tsx,js,mjs}','apps/**/*.{ts,tsx,js,mjs,svelte}'],
  languageOptions:{parser,parserOptions:{ecmaVersion:'latest',sourceType:'module',ecmaFeatures:{jsx:true}}},
  plugins:{'@nx':nx,'boundaries':boundaries},
  rules:{'@nx/enforce-module-boundaries':['error',{allowCircularSelfDependency:false,allow:['$app/**','$lib/**','$env/**'],banTransitiveDependencies:false,depConstraints:Object.entries(layers).map(([name,allowed])=>({sourceTag:`layer:${name}`,onlyDependOnLibsWithTags:allowed.map(v=>`layer:${v}`)}))}],'boundaries/imports':'error'}
 },
 { files:['apps/**/*.svelte'],languageOptions:{parser:svelteParser,parserOptions:{parser}} },
 { files:['packages/shared/src/**/*.{ts,js,tsx}'],ignores:['**/*.test.*','**/*.spec.*'],rules:{'no-restricted-globals':['error','process','Buffer','Bun','Deno']} }
];
