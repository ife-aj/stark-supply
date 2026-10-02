export type Product = { id: string; name: string; description: string; category: string; price: number; image: string; tag: string };
export const catalog: Product[] = [
 {id:'11111111-1111-4111-8111-111111111111', name:'Beats Mixr',description:'Over-ear headphones · White',category:'Audio',price:6500000,image:'/products/headphones.png',tag:'THE DAILY LISTEN'},
 {id:'22222222-2222-4222-8222-222222222222', name:'Keychron V2',description:'Mechanical keyboard · RGB',category:'Workspace',price:9500000,image:'/products/keyboard.jpg',tag:'MAKE EVERY KEY COUNT'},
 {id:'33333333-3333-4333-8333-333333333333', name:'onn Wireless Mouse',description:'Wireless mouse · White',category:'Workspace',price:1850000,image:'/products/mouse.jpg',tag:'LESS FRICTION'},
 {id:'44444444-4444-4444-8444-444444444444', name:'JBL Flip',description:'Portable Bluetooth speaker · Black',category:'Audio',price:7500000,image:'/products/speaker.jpg',tag:'SOUND THAT GOES WITH YOU'},
];
export const money = (kobo: number) => new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:0}).format(kobo/100);
export const delivery = (subtotal: number) => subtotal >= 15000000 ? 0 : 250000;
