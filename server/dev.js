// Run both local services in one Node process on Windows.
await import('./index.js');
const {createServer}=await import('vite');
const {default:react}=await import('@vitejs/plugin-react');

const vite=await createServer({
 configFile:false,
 plugins:[react()],
 server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{
  '/api':'http://127.0.0.1:4000',
  '/socket.io':{target:'http://127.0.0.1:4000',ws:true}
 }}
});
await vite.listen();
vite.printUrls();
