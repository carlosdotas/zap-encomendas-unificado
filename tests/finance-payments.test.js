'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {money}=require('../finance-payments');
test('valores em centavos, sem ponto flutuante',()=>{
 assert.equal(money('10.25'),1025n);
 assert.equal(money('0.01'),1n);
 assert.equal(money('10'),1000n);
 assert.equal(money('0'),null);
 assert.equal(money('-1'),null);
 assert.equal(money('1.234'),null);
 assert.equal(money('10,25'),null);
 assert.equal(money('abc'),null);
});
