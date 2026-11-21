/**
 * „Márkázott” (branded) típus: futásidőben sima string/number, de a TypeScript
 * megkülönbözteti. Így egy ellenőrizetlen `string` nem adható át `Isin`-ként –
 * csak a validáló `parse…` függvényen keresztül lehet ilyen értéket előállítani.
 */
declare const brandSymbol: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brandSymbol]: B };
