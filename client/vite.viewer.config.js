import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from "vite-plugin-singlefile"

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), viteSingleFile()],
    build: {
        outDir: 'public',
        emptyOutDir: false, // Don't delete existing public assets
        rollupOptions: {
            input: {
                viewer: 'index.html', // Use the main index.html as the template
            },
            output: {
                entryFileNames: 'viewer.js', // Although singlefile inlines it, good to have predictable naming if it didn't
                assetFileNames: 'viewer.[ext]',
            }
        }
    }
})
