import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],server:{host:'127.0.0.1',port:Number(process.env.VITE_PORT??5173),strictPort:true,proxy:{'/api':process.env.VITE_API??'http://127.0.0.1:8001'}}});
