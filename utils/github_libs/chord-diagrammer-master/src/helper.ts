import { AttributeDictionary } from './models/attributeDictionary';

export class Helper {
	static createSVGElement(
		name: string,
		attributes?: AttributeDictionary,
		dashValues: boolean = false
	): SVGElement {
		const node = document.createElementNS('http://www.w3.org/2000/svg', name);
		for (let attr in attributes) {
			if (dashValues) {
				node.setAttributeNS(
					null,
					attr.replace(/[A-Z]/g, function (m, p, o, s) {
						return '-' + m.toLowerCase();
					}),
					attributes[attr].toString()
				);
			} else {
				node.setAttributeNS(null, attr, attributes[attr].toString());
			}
		}
		return node;
	}

    static appendTextNode(node: SVGElement, val: string): SVGElement {
        const textNode = document.createTextNode(val);
        node.appendChild(textNode);
        return node;
    }
}
