'use strict';
'require validation';
'require baseclass';
'require request';
'require session';
'require poll';
'require dom';
'require rpc';
'require uci';
'require fs';

let modalDiv = null;
let tooltipDiv = null;
let indicatorDiv = null;
let tooltipTimeout = null;

/**
 * @class AbstractElement
 * @memberof LuCI.ui
 * @hideconstructor
 * @classdesc
 *
 * The `AbstractElement` class serves as abstract base for the different widgets
 * implemented by `LuCI.ui`. It provides the common logic for getting and
 * setting values, for checking the validity state and for wiring up required
 * events.
 *
 * UI widget instances are usually not supposed to be created by view code
 * directly, instead they're implicitly created by `LuCI.form` when
 * instantiating CBI forms.
 *
 * This class is automatically instantiated as part of `LuCI.ui`. To use it
 * in views, use `'require ui'` and refer to `ui.AbstractElement`. To import
 * it in external JavaScript, use `L.require("ui").then(...)` and access the
 * `AbstractElement` property of the class instance value.
 */
const UIElement = baseclass.extend(/** @lends LuCI.ui.AbstractElement.prototype */ {
	/**
	 * @typedef {Object} InitOptions
	 * @memberof LuCI.ui.AbstractElement
	 *
	 * @property {string} [id]
	 * Specifies the widget ID to use. It will be used as HTML `id` attribute
	 * on the toplevel widget DOM node.
	 *
	 * @property {string} [name]
	 * Specifies the widget name which is set as HTML `name` attribute on the
	 * corresponding `<input>` element.
	 *
	 * @property {boolean} [optional=true]
	 * Specifies whether the input field allows empty values.
	 *
	 * @property {string} [datatype=string]
	 * An expression describing the input data validation constraints.
	 * It defaults to `string` which will allow any value.
	 * See {@link LuCI.validation} for details on the expression format.
	 *
	 * @property {function} [validator]
	 * Specifies a custom validator function which is invoked after the
	 * standard validation constraints are checked. The function should return
	 * `true` to accept the given input value. Any other return value type is
	 * converted to a string and treated as validation error message.
	 *
	 * @property {boolean} [disabled=false]
	 * Specifies whether the widget should be rendered in disabled state
	 * (`true`) or not (`false`). Disabled widgets cannot be interacted with
	 * and are displayed in a slightly faded style.
	 */

	/**
	 * Read the current value of the input widget.
	 *
	 * @instance
	 * @memberof LuCI.ui.AbstractElement
	 * @returns {string|string[]|null}
	 * The current value of the input element. For simple inputs like text
	 * fields or selects, the return value type will be a - possibly empty -
	 * string. Complex widgets such as `DynamicList` instances may result in
	 * an array of strings or `null` for unset values.
	 */
	getValue() {
		if (dom.matches(this.node, 'select') || dom.matches(this.node, 'input'))
			return this.node.value;

		return null;
	},

	/**
	 * Set the current value of the input widget.
	 *
	 * @instance
	 * @memberof LuCI.ui.AbstractElement
	 * @param {string|string[]|null} value
	 * The value to set the input element to. For simple inputs like text
	 * fields or selects, the value should be a - possibly empty - string.
	 * Complex widgets such as `DynamicList` instances may accept string array
	 * or `null` values.
	 */
	setValue(value) {
		if (dom.matches(this.node, 'select') || dom.matches(this.node, 'input'))
			this.node.value = value;
	},

	/**
	 * Set the current placeholder value of the input widget.
	 *
	 * @instance
	 * @memberof LuCI.ui.AbstractElement
	 * @param {string|string[]|null} value
	 * The placeholder to set for the input element. Only applicable to text
	 * inputs, not to radio buttons, selects or similar.
	 */
	setPlaceholder(value) {
		const node = this.node ? this.node.querySelector('input,textarea') : null;
		if (node) {
			switch (node.getAttribute('type') ?? 'text') {
			case 'password':
			case 'search':
			case 'tel':
			case 'text':
			case 'url':
				if (value != null && value != '')
					node.setAttribute('placeholder', value);
				else
					node.removeAttribute('placeholder');
			}
		}
	},

	/**
	 * Check whether the input value was altered by the user.
	 *
	 * @instance
	 * @memberof LuCI.ui.AbstractElement
	 * @returns {boolean}
	 * Returns `true` if the input value has been altered by the user or
	 * `false` if it is unchanged. Note that if the user modifies the initial
	 * value and changes it back to the original state, it is still reported
	 * as changed.
	 */
	isChanged() {
		return (this.node ? this.node.getAttribute('data-changed') : null) == 'true';
	},

	/**
	 * Check whether the current input value is valid.
	 *
	 * @instance
	 * @memberof LuCI.ui.AbstractElement
	 * @returns {boolean}
	 * Returns `true` if the current input value is valid or `false` if it does
	 * not meet the validation constraints.
	 */
	isValid() {
		return (this.validState !== false);
	},

	/**
	 * Returns the current validation error
	 *
	 * @instance
	 * @memberof LuCI.ui.AbstractElement
	 * @returns {string}
	 * The validation error at this time
	 */
	getValidationError() {
		return this.validationError ?? '';
	},

	/**
	 * Force validation of the current input value.
	 *
	 * Usually input validation is automatically triggered by various DOM events
	 * bound to the input widget. In some cases it is required though to manually
	 * trigger validation runs, e.g. when programmatically altering values.
	 *
	 * @instance
	 * @memberof LuCI.ui.AbstractElement
	 */
	triggerValidation() {
		if (typeof(this.vfunc) != 'function')
			return false;

		const wasValid = this.isValid();

		this.vfunc();

		return (wasValid != this.isValid());
	},

	/**
	 * Dispatch a custom (synthetic) event in response to received events.
	 *
	 * Sets up event handlers on the given target DOM node for the given event
	 * names that dispatch a custom event of the given type to the widget root
	 * DOM node.
	 *
	 * The primary purpose of this function is to set up a series of custom
	 * uniform standard events such as `widget-update`, `validation-success`,
	 * `validation-failure` etc. which are triggered by various different
	 * widget specific native DOM events.
	 *
	 * @instance
	 * @memberof LuCI.ui.AbstractElement
	 * @param {Node} targetNode
	 * Specifies the DOM node on which the native event listeners should be
	 * registered.
	 *
	 * @param {string} synevent
	 * The name of the custom event to dispatch to the widget root DOM node.
	 *
	 * @param {string[]} events
	 * The native DOM events for which event handlers should be registered.
	 */
	registerEvents(targetNode, synevent, events) {
		const dispatchFn = L.bind((ev) => {
			this.node.dispatchEvent(new CustomEvent(synevent, { bubbles: true }));
		}, this);

		for (let i = 0; i < events.length; i++)
			targetNode.addEventListener(events[i], dispatchFn);
	},

	/**
	 * Set up listeners for native DOM events that may update the widget value.
	 *
	 * Sets up event handlers on the given target DOM node for the given event
	 * names which may cause the input value to update, such as `keyup` or
	 * `onclick` events. In contrast to change events, such update events will
	 * trigger input value validation.
	 *
	 * @instance
	 * @memberof LuCI.ui.AbstractElement
	 * @param {Node} targetNode
	 * Specifies the DOM node on which the event listeners should be registered.
	 *
	 * @param {...string} events
	 * The DOM events for which event handlers should be registered.
	 */
	setUpdateEvents(targetNode, ...events) {
		const datatype = this.options.datatype;
		const optional = this.options.hasOwnProperty('optional') ? this.options.optional : true;
		const validate = this.options.validate;

		this.registerEvents(targetNode, 'widget-update', events);

		if (!datatype && !validate)
			return;

		this.vfunc = UI.prototype.addValidator(...[
			targetNode, datatype ?? 'string',
			optional, validate
		].concat(events));

		this.node.addEventListener('validation-success', L.bind((ev) => {
			this.validState = true;
			this.validationError = '';
		}, this));

		this.node.addEventListener('validation-failure', L.bind((ev) => {
			this.validState = false;
			this.validationError = ev.detail.message;
		}, this));
	},

	/**
	 * Set up listeners for native DOM events that may change the widget value.
	 *
	 * Sets up event handlers on the given target DOM node for the given event
	 * names which may cause the input value to change completely, such as
	 * `change` events in a select menu. In contrast to update events, such
	 * change events will not trigger input value validation but they may cause
	 * field dependencies to get re-evaluated and will mark the input widget
	 * as dirty.
	 *
	 * @instance
	 * @memberof LuCI.ui.AbstractElement
	 * @param {Node} targetNode
	 * Specifies the DOM node on which the event listeners should be registered.
	 *
	 * @param {...string} events
	 * The DOM events for which event handlers should be registered.
	 */
	setChangeEvents(targetNode, ...events) {
		const tag_changed = L.bind(function(ev) { this.setAttribute('data-changed', true) }, this.node);

		for (let i = 0; i < events.length; i++)
			targetNode.addEventListener(events[i], tag_changed);

		this.registerEvents(targetNode, 'widget-change', events);
	},

	/**
	 * Render the widget, set up event listeners and return resulting markup.
	 *
	 * @instance
	 * @memberof LuCI.ui.AbstractElement
	 *
	 * @returns {Node}
	 * Returns a DOM Node or DocumentFragment containing the rendered
	 * widget markup.
	 */
	render() {}
});

/**
 * Instantiate a text input widget.
 *
 * @constructor Textfield
 * @memberof LuCI.ui
 * @augments LuCI.ui.AbstractElement
 *
 * @classdesc
 *
 * The `Textfield` class implements a standard single line text input field.
 *
 * UI widget instances are usually not supposed to be created by view code
 * directly, instead they're implicitly created by `LuCI.form` when
 * instantiating CBI forms.
 *
 * This class is automatically instantiated as part of `LuCI.ui`. To use it
 * in views, use `'require ui'` and refer to `ui.Textfield`. To import it in
 * external JavaScript, use `L.require("ui").then(...)` and access the
 * `Textfield` property of the class instance value.
 *
 * @param {string} [value=null]
 * The initial input value.
 *
 * @param {LuCI.ui.Textfield.InitOptions} [options]
 * Object describing the widget specific options to initialize the input.
 */
const UITextfield = UIElement.extend(/** @lends LuCI.ui.Textfield.prototype */ {
	/**
	 * In addition to the [AbstractElement.InitOptions]{@link LuCI.ui.AbstractElement.InitOptions}
	 * the following properties are recognized:
	 *
	 * @typedef {LuCI.ui.AbstractElement.InitOptions} InitOptions
	 * @memberof LuCI.ui.Textfield
	 *
	 * @property {boolean} [password=false]
	 * Specifies whether the input should be rendered as concealed password field.
	 *
	 * @property {boolean} [readonly=false]
	 * Specifies whether the input widget should be rendered readonly.
	 *
	 * @property {number} [maxlength]
	 * Specifies the HTML `maxlength` attribute to set on the corresponding
	 * `<input>` element. Note that this a legacy property that exists for
	 * compatibility reasons. It is usually better to `maxlength(N)` validation
	 * expression.
	 *
	 * @property {string} [placeholder]
	 * Specifies the HTML `placeholder` attribute which is displayed when the
	 * corresponding `<input>` element is empty.
	 */
	__init__(value, options) {
		this.value = value;
		this.options = Object.assign({
			optional: true,
			password: false
		}, options);
	},

	/** @override */
	render() {
		const frameEl = E('div', { 'id': this.options.id });
		const inputEl = E('input', {
			'id': this.options.id ? `widget.${this.options.id}` : null,
			'name': this.options.name,
			'type': 'text',
			'class': `password-input ${this.options.password ? 'cbi-input-password' : 'cbi-input-text'}`,
			'readonly': this.options.readonly ? '' : null,
			'disabled': this.options.disabled ? '' : null,
			'maxlength': this.options.maxlength,
			'placeholder': this.options.placeholder,
			'value': this.value,
		});

		if (this.options.password) {
			frameEl.appendChild(E('div', { 'class': 'control-group' }, [
				inputEl,
				E('button', {
					'class': 'cbi-button cbi-button-neutral',
					'title': _('Reveal/hide password'),
					'aria-label': _('Reveal/hide password'),
					'click': function(ev) {
						// DOM manipulation (e.g. by password managers) may have inserted other
						// elements between the reveal button and the input. This searches for
						// the first <input> inside the parent of the <button> to use for toggle.
						const e = this.parentElement.querySelector('input.password-input')
						if (e) {
							e.type = (e.type === 'password') ? 'text' : 'password';
						} else {
							console.error('unable to find input corresponding to reveal/hide button');
						}
						ev.preventDefault();
					}
				}, '∗')
			]));

			window.requestAnimationFrame(() => { inputEl.type = 'password' });
		}
		else {
			frameEl.appendChild(inputEl);
		}

		return this.bind(frameEl);
	},

	/** @private */
	bind(frameEl) {
		const inputEl = frameEl.querySelector('input');

		this.node = frameEl;

		this.setUpdateEvents(inputEl, 'keyup', 'blur');
		this.setChangeEvents(inputEl, 'change');

		dom.bindClassInstance(frameEl, this);

		return frameEl;
	},

	/** @override */
	getValue() {
		const inputEl = this.node.querySelector('input');
		return inputEl.value;
	},

	/** @override */
	setValue(value) {
		const inputEl = this.node.querySelector('input');
		inputEl.value = value;
	}
});

/**
 * Instantiate a textarea widget.
 *
 * @constructor Textarea
 * @memberof LuCI.ui
 * @augments LuCI.ui.AbstractElement
 *
 * @classdesc
 *
 * The `Textarea` class implements a multiline text area input field.
 *
 * UI widget instances are usually not supposed to be created by view code
 * directly, instead they're implicitly created by `LuCI.form` when
 * instantiating CBI forms.
 *
 * This class is automatically instantiated as part of `LuCI.ui`. To use it
 * in views, use `'require ui'` and refer to `ui.Textarea`. To import it in
 * external JavaScript, use `L.require("ui").then(...)` and access the
 * `Textarea` property of the class instance value.
 *
 * @param {string} [value=null]
 * The initial input value.
 *
 * @param {LuCI.ui.Textarea.InitOptions} [options]
 * Object describing the widget specific options to initialize the input.
 */
const UITextarea = UIElement.extend(/** @lends LuCI.ui.Textarea.prototype */ {
	/**
	 * In addition to the [AbstractElement.InitOptions]{@link LuCI.ui.AbstractElement.InitOptions}
	 * the following properties are recognized:
	 *
	 * @typedef {LuCI.ui.AbstractElement.InitOptions} InitOptions
	 * @memberof LuCI.ui.Textarea
	 *
	 * @property {boolean} [readonly=false]
	 * Specifies whether the input widget should be rendered readonly.
	 *
	 * @property {string} [placeholder]
	 * Specifies the HTML `placeholder` attribute which is displayed when the
	 * corresponding `<textarea>` element is empty.
	 *
	 * @property {boolean} [monospace=false]
	 * Specifies whether a monospace font should be forced for the textarea
	 * contents.
	 *
	 * @property {number} [cols]
	 * Specifies the HTML `cols` attribute to set on the corresponding
	 * `<textarea>` element.
	 *
	 * @property {number} [rows]
	 * Specifies the HTML `rows` attribute to set on the corresponding
	 * `<textarea>` element.
	 *
	 * @property {boolean} [wrap=false]
	 * Specifies whether the HTML `wrap` attribute should be set.
	 */
	__init__(value, options) {
		this.value = value;
		this.options = Object.assign({
			optional: true,
			wrap: false,
			cols: null,
			rows: null
		}, options);
	},

	/** @override */
	render() {
		const style = !this.options.cols ? 'width:100%' : null;
		const frameEl = E('div', { 'id': this.options.id, 'style': style });
		const value = (this.value != null) ? String(this.value) : '';

		frameEl.appendChild(E('textarea', {
			'id': this.options.id ? `widget.${this.options.id}` : null,
			'name': this.options.name,
			'class': 'cbi-input-textarea',
			'readonly': this.options.readonly ? '' : null,
			'disabled': this.options.disabled ? '' : null,
			'placeholder': this.options.placeholder,
			'style': style,
			'cols': this.options.cols,
			'rows': this.options.rows,
			'wrap': this.options.wrap ? 'soft' : 'off'
		}, [ value ]));

		if (this.options.monospace)
			frameEl.firstElementChild.style.fontFamily = 'monospace';

		return this.bind(frameEl);
	},

	/** @private */
	bind(frameEl) {
		const inputEl = frameEl.firstElementChild;

		this.node = frameEl;

		this.setUpdateEvents(inputEl, 'keyup', 'blur');
		this.setChangeEvents(inputEl, 'change');

		dom.bindClassInstance(frameEl, this);

		return frameEl;
	},

	/** @override */
	getValue() {
		return this.node.firstElementChild.value;
	},

	/** @override */
	setValue(value) {
		this.node.firstElementChild.value = value;
	}
});

/**
 * Instantiate a checkbox widget.
 *
 * @constructor Checkbox
 * @memberof LuCI.ui
 * @augments LuCI.ui.AbstractElement
 *
 * @classdesc
 *
 * The `Checkbox` class implements a simple checkbox input field.
 *
 * UI widget instances are usually not supposed to be created by view code
 * directly, instead they're implicitly created by `LuCI.form` when
 * instantiating CBI forms.
 *
 * This class is automatically instantiated as part of `LuCI.ui`. To use it
 * in views, use `'require ui'` and refer to `ui.Checkbox`. To import it in
 * external JavaScript, use `L.require("ui").then(...)` and access the
 * `Checkbox` property of the class instance value.
 *
 * @param {string} [value=null]
 * The initial input value.
 *
 * @param {LuCI.ui.Checkbox.InitOptions} [options]
 * Object describing the widget specific options to initialize the input.
 */
const UICheckbox = UIElement.extend(/** @lends LuCI.ui.Checkbox.prototype */ {
	/**
	 * In addition to the [AbstractElement.InitOptions]{@link LuCI.ui.AbstractElement.InitOptions}
	 * the following properties are recognized:
	 *
	 * @typedef {LuCI.ui.AbstractElement.InitOptions} InitOptions
	 * @memberof LuCI.ui.Checkbox
	 *
	 * @property {string} [value_enabled=1]
	 * Specifies the value corresponding to a checked checkbox.
	 *
	 * @property {string} [value_disabled=0]
	 * Specifies the value corresponding to an unchecked checkbox.
	 *
	 * @property {string} [hiddenname]
	 * Specifies the HTML `name` attribute of the hidden input backing the
	 * checkbox. This is a legacy property existing for compatibility reasons,
	 * it is required for HTML based form submissions.
	 */
	__init__(value, options) {
		this.value = value;
		this.options = Object.assign({
			value_enabled: '1',
			value_disabled: '0'
		}, options);
	},

	/** @override */
	render() {
		const id = 'cb%08x'.format(Math.random() * 0xffffffff);
		const frameEl = E('div', {
			'id': this.options.id,
			'class': 'cbi-checkbox'
		});

		if (this.options.hiddenname)
			frameEl.appendChild(E('input', {
				'type': 'hidden',
				'name': this.options.hiddenname,
				'value': 1
			}));

		frameEl.appendChild(E('input', {
			'id': id,
			'name': this.options.name,
			'type': 'checkbox',
			'value': this.options.value_enabled,
			'checked': (this.value == this.options.value_enabled) ? '' : null,
			'disabled': this.options.disabled ? '' : null,
			'data-widget-id': this.options.id ? `widget.${this.options.id}` : null
		}));

		frameEl.appendChild(E('label', { 'for': id }));

		if (this.options.tooltip != null) {
			let icon = "⚠️";

			if (this.options.tooltipicon != null)
				icon = this.options.tooltipicon;

			frameEl.appendChild(
				E('label', { 'class': 'cbi-tooltip-container' },[
					icon,
					E('div', { 'class': 'cbi-tooltip' },
						this.options.tooltip
					)
				])
			);
		}

		return this.bind(frameEl);
	},

	/** @private */
	bind(frameEl) {
		this.node = frameEl;

		const input = frameEl.querySelector('input[type="checkbox"]');
		this.setUpdateEvents(input, 'click', 'blur');
		this.setChangeEvents(input, 'change');

		dom.bindClassInstance(frameEl, this);

		return frameEl;
	},

	/**
	 * Test whether the checkbox is currently checked.
	 *
	 * @instance
	 * @memberof LuCI.ui.Checkbox
	 * @returns {boolean}
	 * Returns `true` when the checkbox is currently checked, otherwise `false`.
	 */
	isChecked() {
		return this.node.querySelector('input[type="checkbox"]').checked;
	},

	/** @override */
	getValue() {
		return this.isChecked()
			? this.options.value_enabled
			: this.options.value_disabled;
	},

	/** @override */
	setValue(value) {
		this.node.querySelector('input[type="checkbox"]').checked = (value == this.options.value_enabled);
	}
});

/**
 * Instantiate a select dropdown or checkbox/radiobutton group.
 *
 * @constructor Select
 * @memberof LuCI.ui
 * @augments LuCI.ui.AbstractElement
 *
 * @classdesc
 *
 * The `Select` class implements either a traditional HTML `<select>` element
 * or a group of checkboxes or radio buttons, depending on whether multiple
 * values are enabled or not.
 *
 * UI widget instances are usually not supposed to be created by view code
 * directly, instead they're implicitly created by `LuCI.form` when
 * instantiating CBI forms.
 *
 * This class is automatically instantiated as part of `LuCI.ui`. To use it
 * in views, use `'require ui'` and refer to `ui.Select`. To import it in
 * external JavaScript, use `L.require("ui").then(...)` and access the
 * `Select` property of the class instance value.
 *
 * @param {string|string[]} [value=null]
 * The initial input value(s).
 *
 * @param {Object<string, string>} choices
 * Object containing the selectable choices of the widget. The object keys
 * serve as values for the different choices while the values are used as
 * choice labels.
 *
 * @param {LuCI.ui.Select.InitOptions} [options]
 * Object describing the widget specific options to initialize the inputs.
 */
const UISelect = UIElement.extend(/** @lends LuCI.ui.Select.prototype */ {
	/**
	 * In addition to the [AbstractElement.InitOptions]{@link LuCI.ui.AbstractElement.InitOptions}
	 * the following properties are recognized:
	 *
	 * @typedef {LuCI.ui.AbstractElement.InitOptions} InitOptions
	 * @memberof LuCI.ui.Select
	 *
	 * @property {boolean} [multiple=false]
	 * Specifies whether multiple choice values may be selected.
	 *
	 * @property {"select"|"individual"} [widget=select]
	 * Specifies the kind of widget to render. May be either `select` or
	 * `individual`. When set to `select` an HTML `<select>` element will be
	 * used, otherwise a group of checkbox or radio button elements is created,
	 * depending on the value of the `multiple` option.
	 *
	 * @property {string} [orientation=horizontal]
	 * Specifies whether checkbox / radio button groups should be rendered
	 * in a `horizontal` or `vertical` manner. Does not apply to the `select`
	 * widget type.
	 *
	 * @property {boolean|string[]} [sort=false]
	 * Specifies if and how to sort choice values. If set to `true`, the choice
	 * values will be sorted alphabetically. If set to an array of strings, the
	 * choice sort order is derived from the array.
	 *
	 * @property {number} [size]
	 * Specifies the HTML `size` attribute to set on the `<select>` element.
	 * Only applicable to the `select` widget type.
	 *
	 * @property {string} [placeholder=-- Please choose --]
	 * Specifies a placeholder text which is displayed when no choice is
	 * selected yet. Only applicable to the `select` widget type.
	 */
	__init__(value, choices, options) {
		if (!L.isObject(choices))
			choices = {};

		if (!Array.isArray(value))
			value = (value != null && value != '') ? [ value ] : [];

		if (!options.multiple && value.length > 1)
			value.length = 1;

		this.values = value;
		this.choices = choices;
		this.options = Object.assign({
			multiple: false,
			widget: 'select',
			orientation: 'horizontal'
		}, options);

		if (this.choices.hasOwnProperty(''))
			this.options.optional = true;
	},

	/** @override */
	render() {
		const frameEl = E('div', { 'id': this.options.id });
		let keys = Object.keys(this.choices);

		if (this.options.sort === true)
			keys.sort(L.naturalCompare);
		else if (Array.isArray(this.options.sort))
			keys = this.options.sort;

		if (this.options.widget != 'radio' && this.options.widget != 'checkbox') {
			frameEl.appendChild(E('select', {
				'id': this.options.id ? `widget.${this.options.id}` : null,
				'name': this.options.name,
				'size': this.options.size,
				'class': 'cbi-input-select',
				'multiple': this.options.multiple ? '' : null,
				'disabled': this.options.disabled ? '' : null
			}));

			if (this.options.optional)
				frameEl.lastChild.appendChild(E('option', {
					'value': '',
					'selected': (this.values.length == 0 || this.values[0] == '') ? '' : null
				}, [ this.choices[''] ?? this.options.placeholder ?? _('-- Please choose --') ]));

			for (let i = 0; i < keys.length; i++) {
				if (keys[i] == null || keys[i] == '')
					continue;

				frameEl.lastChild.appendChild(E('option', {
					'value': keys[i],
					'selected': (this.values.indexOf(keys[i]) > -1) ? '' : null
				}, [ this.choices[keys[i]] ?? keys[i] ]));
			}
		}
		else {
			const brEl = (this.options.orientation === 'horizontal') ? document.createTextNode(' \xa0 ') : E('br');

			for (let i = 0; i < keys.length; i++) {
				frameEl.appendChild(E('span', {
					'class': 'cbi-%s'.format(this.options.multiple ? 'checkbox' : 'radio')
				}, [
					E('input', {
						'id': this.options.id ? 'widget.%s.%d'.format(this.options.id, i) : null,
						'name': this.options.id ?? this.options.name,
						'type': this.options.multiple ? 'checkbox' : 'radio',
						'class': this.options.multiple ? 'cbi-input-checkbox' : 'cbi-input-radio',
						'value': keys[i],
						'checked': (this.values.indexOf(keys[i]) > -1) ? '' : null,
						'disabled': this.options.disabled ? '' : null
					}),
					E('label', { 'for': this.options.id ? 'widget.%s.%d'.format(this.options.id, i) : null }),
					E('span', {
						'click': function(ev) {
							ev.currentTarget.previousElementSibling.previousElementSibling.click();
						}
					}, [ this.choices[keys[i]] ?? keys[i] ])
				]));

				frameEl.appendChild(brEl.cloneNode());
			}
		}

		return this.bind(frameEl);
	},

	/** @private */
	bind(frameEl) {
		this.node = frameEl;

		if (this.options.widget != 'radio' && this.options.widget != 'checkbox') {
			this.setUpdateEvents(frameEl.firstChild, 'change', 'click', 'blur');
			this.setChangeEvents(frameEl.firstChild, 'change');
		}
		else {
			const radioEls = frameEl.querySelectorAll('input[type="radio"]');
			for (let i = 0; i < radioEls.length; i++) {
				this.setUpdateEvents(radioEls[i], 'change', 'click', 'blur');
				this.setChangeEvents(radioEls[i], 'change', 'click', 'blur');
			}
		}

		dom.bindClassInstance(frameEl, this);

		return frameEl;
	},

	/** @override */
	getValue() {
		if (this.options.widget != 'radio' && this.options.widget != 'checkbox')
			return this.node.firstChild.value;

		const radioEls = this.node.querySelectorAll('input[type="radio"]');
		for (let i = 0; i < radioEls.length; i++)
			if (radioEls[i].checked)
				return radioEls[i].value;

		return null;
	},

	/** @override */
	setValue(value) {
		if (this.options.widget != 'radio' && this.options.widget != 'checkbox') {
			if (value == null)
				value = '';

			for (let i = 0; i < this.node.firstChild.options.length; i++)
				this.node.firstChild.options[i].selected = (this.node.firstChild.options[i].value == value);

			return;
		}

		const radioEls = frameEl.querySelectorAll('input[type="radio"]');
		for (let i = 0; i < radioEls.length; i++)
			radioEls[i].checked = (radioEls[i].value == value);
	}
});

/**
 * Instantiate a rich dropdown choice widget.
 *
 * @constructor Dropdown
 * @memberof LuCI.ui
 * @augments LuCI.ui.AbstractElement
 *
 * @classdesc
 *
 * The `Dropdown` class implements a rich, stylable dropdown menu which
 * supports non-text choice labels.
 *
 * UI widget instances are usually not supposed to be created by view code
 * directly, instead they're implicitly created by `LuCI.form` when
 * instantiating CBI forms.
 *
 * This class is automatically instantiated as part of `LuCI.ui`. To use it
 * in views, use `'require ui'` and refer to `ui.Dropdown`. To import it in
 * external JavaScript, use `L.require("ui").then(...)` and access the
 * `Dropdown` property of the class instance value.
 *
 * @param {string|string[]} [value=null]
 * The initial input value(s).
 *
 * @param {Object<string, *>} choices
 * Object containing the selectable choices of the widget. The object keys
 * serve as values for the different choices while the values are used as
 * choice labels.
 *
 * @param {LuCI.ui.Dropdown.InitOptions} [options]
 * Object describing the widget specific options to initialize the dropdown.
 */
const UIDropdown = UIElement.extend(/** @lends LuCI.ui.Dropdown.prototype */ {
	/**
	 * In addition to the [AbstractElement.InitOptions]{@link LuCI.ui.AbstractElement.InitOptions}
	 * the following properties are recognized:
	 *
	 * @typedef {LuCI.ui.AbstractElement.InitOptions} InitOptions
	 * @memberof LuCI.ui.Dropdown
	 *
	 * @property {boolean} [optional=true]
	 * Specifies whether the dropdown selection is optional. In contrast to
	 * other widgets, the `optional` constraint of dropdowns works differently;
	 * instead of marking the widget invalid on empty values when set to `false`,
	 * the user is not allowed to deselect all choices.
	 *
	 * For single value dropdowns that means that no empty "please select"
	 * choice is offered and for multi value dropdowns, the last selected choice
	 * may not be deselected without selecting another choice first.
	 *
	 * @property {boolean} [multiple]
	 * Specifies whether multiple choice values may be selected. It defaults
	 * to `true` when an array is passed as input value to the constructor.
	 *
	 * @property {boolean|string[]} [sort=false]
	 * Specifies if and how to sort choice values. If set to `true`, the choice
	 * values will be sorted alphabetically. If set to an array of strings, the
	 * choice sort order is derived from the array.
	 *
	 * @property {string} [select_placeholder=-- Please choose --]
	 * Specifies a placeholder text which is displayed when no choice is
	 * selected yet.
	 *
	 * @property {string} [custom_placeholder=-- custom --]
	 * Specifies a placeholder text which is displayed in the text input
	 * field allowing to enter custom choice values. Only applicable if the
	 * `create` option is set to `true`.
	 *
	 * @property {boolean} [create=false]
	 * Specifies whether custom choices may be entered into the dropdown
	 * widget.
	 *
	 * @property {string} [create_query=.create-item-input]
	 * Specifies a CSS selector expression used to find the input element
	 * which is used to enter custom choice values. This should not normally
	 * be used except by widgets derived from the Dropdown class.
	 *
	 * @property {string} [create_template=script[type="item-template"]]
	 * Specifies a CSS selector expression used to find an HTML element
	 * serving as template for newly added custom choice values.
	 *
	 * Any `{{value}}` placeholder string within the template elements text
	 * content will be replaced by the user supplied choice value, the
	 * resulting string is parsed as HTML and appended to the end of the
	 * choice list. The template markup may specify one HTML element with a
	 * `data-label-placeholder` attribute which is replaced by a matching
	 * label value from the `choices` object or with the user supplied value
	 * itself in case `choices` contains no matching choice label.
	 *
	 * If the template element is not found or if no `create_template` selector
	 * expression is specified, the default markup for newly created elements is
	 * `<li data-value="{{value}}"><span data-label-placeholder="true" /></li>`.
	 *
	 * @property {string} [create_markup]
	 * This property allows specifying the markup for custom choices directly
	 * instead of referring to a template element through CSS selectors.
	 *
	 * Apart from that it works exactly like `create_template`.
	 *
	 * @property {number} [display_items=3]
	 * Specifies the maximum amount of choice labels that should be shown in
	 * collapsed dropdown state before further selected choices are cut off.
	 *
	 * Only applicable when `multiple` is `true`.
	 *
	 * @property {number} [dropdown_items=-1]
	 * Specifies the maximum amount of choices that should be shown when the
	 * dropdown is open. If the amount of available choices exceeds this number,
	 * the dropdown area must be scrolled to reach further items.
	 *
	 * If set to `-1`, the dropdown menu will attempt to show all choice values
	 * and only resort to scrolling if the amount of choices exceeds the available
	 * screen space above and below the dropdown widget.
	 *
	 * @property {string} [placeholder]
	 * This property serves as a shortcut to set both `select_placeholder` and
	 * `custom_placeholder`. Either of these properties will fallback to
	 * `placeholder` if not specified.
	 *
	 * @property {boolean} [readonly=false]
	 * Specifies whether the custom choice input field should be rendered
	 * readonly. Only applicable when `create` is `true`.
	 *
	 * @property {number} [maxlength]
	 * Specifies the HTML `maxlength` attribute to set on the custom choice
	 * `<input>` element. Note that this a legacy property that exists for
	 * compatibility reasons. It is usually better to `maxlength(N)` validation
	 * expression. Only applicable when `create` is `true`.
	 */
	__init__(value, choices, options) {
		if (typeof(choices) != 'object')
			choices = {};

		if (!Array.isArray(value))
			this.values = (value != null && value != '') ? [ value ] : [];
		else
			this.values = value;

		this.choices = choices;
		this.options = Object.assign({
			sort:               true,
			multiple:           Array.isArray(value),
			optional:           true,
			select_placeholder: _('-- Please choose --'),
			custom_placeholder: _('-- custom --'),
			display_items:      3,
			dropdown_items:     -1,
			create:             false,
			create_query:       '.create-item-input',
			create_template:    'script[type="item-template"]'
		}, options);
	},

	/** @override */
	render() {
		const sb = E('div', {
			'id': this.options.id,
			'class': 'cbi-dropdown',
			'multiple': this.options.multiple ? '' : null,
			'optional': this.options.optional ? '' : null,
			'disabled': this.options.disabled ? '' : null,
			'tabindex': -1
		}, E('ul'));

		let keys = Object.keys(this.choices);

		if (this.options.sort === true)
			keys.sort(L.naturalCompare);
		else if (Array.isArray(this.options.sort))
			keys = this.options.sort;

		if (this.options.create)
			for (let i = 0; i < this.values.length; i++)
				if (!this.choices.hasOwnProperty(this.values[i]))
					keys.push(this.values[i]);

		for (let i = 0; i < keys.length; i++) {
			let label = this.choices[keys[i]];

			if (dom.elem(label))
				label = label.cloneNode(true);

			sb.lastElementChild.appendChild(E('li', {
				'data-value': keys[i],
				'selected': (this.values.indexOf(keys[i]) > -1) ? '' : null
			}, [ label ?? keys[i] ]));
		}

		if (this.options.create) {
			const createEl = E('input', {
				'type': 'text',
				'class': 'create-item-input',
				'readonly': this.options.readonly ? '' : null,
				'maxlength': this.options.maxlength,
				'placeholder': this.options.custom_placeholder ?? this.options.placeholder,
				'inputmode': 'text',
			});

			if (this.options.datatype || this.options.validate)
				UI.prototype.addValidator(createEl, this.options.datatype ?? 'string',
				                          true, this.options.validate, 'blur', 'keyup');

			sb.lastElementChild.appendChild(E('li', { 'data-value': '-' }, createEl));
		}

		if (this.options.create_markup)
			sb.appendChild(E('script', { type: 'item-template' },
				this.options.create_markup));

		return this.bind(sb);
	},

	/** @private */
	bind(sb) {
		const o = this.options;

		o.multiple = sb.hasAttribute('multiple');
		o.optional = sb.hasAttribute('optional');
		o.placeholder = sb.getAttribute('placeholder') ?? o.placeholder;
		o.display_items = parseInt(sb.getAttribute('display-items') ?? o.display_items);
		o.dropdown_items = parseInt(sb.getAttribute('dropdown-items') ?? o.dropdown_items);
		o.create_query = sb.getAttribute('item-create') ?? o.create_query;
		o.create_template = sb.getAttribute('item-template') ?? o.create_template;

		const ul = sb.querySelector('ul');
		const more = sb.appendChild(E('span', { class: 'more', tabindex: -1 }, '···'));
		const open = sb.appendChild(E('span', { class: 'open', tabindex: -1 }, '▾'));
		const canary = sb.appendChild(E('div'));
		const create = sb.querySelector(this.options.create_query);
		let ndisplay = this.options.display_items;
		let n = 0;

		if (this.options.multiple) {
			let items = ul.querySelectorAll('li');

			for (let i = 0; i < items.length; i++) {
				this.transformItem(sb, items[i]);

				if (items[i].hasAttribute('selected') && ndisplay-- > 0)
					items[i].setAttribute('display', n++);
			}
		}
		else {
			if (this.options.optional && !ul.querySelector('li[data-value=""]')) {
				const placeholder = E('li', { placeholder: '' },
					this.options.select_placeholder ?? this.options.placeholder);

				ul.firstChild
					? ul.insertBefore(placeholder, ul.firstChild)
					: ul.appendChild(placeholder);
			}

			let items = ul.querySelectorAll('li');
			const sel = sb.querySelectorAll('[selected]');

			sel.forEach(s => {
				s.removeAttribute('selected');
			});

			const s = sel[0] ?? items[0];
			if (s) {
				s.setAttribute('selected', '');
				s.setAttribute('display', n++);
			}

			ndisplay--;
		}

		this.saveValues(sb, ul);

		ul.setAttribute('tabindex', -1);
		sb.setAttribute('tabindex', 0);

		if (ndisplay < 0)
			sb.setAttribute('more', '')
		else
			sb.removeAttribute('more');

		if (ndisplay == this.options.display_items)
			sb.setAttribute('empty', '')
		else
			sb.removeAttribute('empty');

		dom.content(more, (ndisplay == this.options.display_items)
			? (this.options.select_placeholder ?? this.options.placeholder) : '···');


		sb.addEventListener('click', this.handleClick.bind(this));
		sb.addEventListener('keydown', this.handleKeydown.bind(this));
		sb.addEventListener('cbi-dropdown-close', this.handleDropdownClose.bind(this));
		sb.addEventListener('cbi-dropdown-select', this.handleDropdownSelect.bind(this));

		if ('ontouchstart' in window) {
			sb.addEventListener('touchstart', ev => ev.stopPropagation());
			window.addEventListener('touchstart', this.closeAllDropdowns);
		}
		else {
			sb.addEventListener('focus', this.handleFocus.bind(this));

			canary.addEventListener('focus', this.handleCanaryFocus.bind(this));

			window.addEventListener('click', this.closeAllDropdowns);
		}

		if (create) {
			create.addEventListener('keydown', this.handleCreateKeydown.bind(this));
			create.addEventListener('focus', this.handleCreateFocus.bind(this));
			create.addEventListener('blur', this.handleCreateBlur.bind(this));

			const li = findParent(create, 'li');

			li.setAttribute('unselectable', '');
			li.addEventListener('click', this.handleCreateClick.bind(this));
		}

		this.node = sb;

		this.setUpdateEvents(sb, 'cbi-dropdown-open', 'cbi-dropdown-close');
		this.setChangeEvents(sb, 'cbi-dropdown-change', 'cbi-dropdown-close');

		dom.bindClassInstance(sb, this);

		return sb;
	},

	/** @private */
	getScrollParent(element) {
		let parent = element;
		let style = getComputedStyle(element);
		const excludeStaticParent = (style.position === 'absolute');

		if (style.position === 'fixed')
			return document.body;

		while ((parent = parent.parentElement) != null) {
			style = getComputedStyle(parent);

			if (excludeStaticParent && style.position === 'static')
				continue;

			if (/(auto|scroll)/.test(style.overflow + style.overflowY + style.overflowX))
				return parent;
		}

		return document.body;
	},

	/** @private */
	openDropdown(sb) {
		const st = window.getComputedStyle(sb, null);
		const ul = sb.querySelector('ul');
		const li = ul.querySelectorAll('li');
		const fl = findParent(sb, '.cbi-value-field');
		const sel = ul.querySelector('[selected]');
		const rect = sb.getBoundingClientRect();
		const items = Math.min(this.options.dropdown_items, li.length);
		const scrollParent = this.getScrollParent(sb);

		document.querySelectorAll('.cbi-dropdown[open]').forEach(s => {
			s.dispatchEvent(new CustomEvent('cbi-dropdown-close', {}));
		});

		sb.setAttribute('open', '');

		const pv = ul.cloneNode(true);
		pv.classList.add('preview');

		if (fl)
			fl.classList.add('cbi-dropdown-open');

		if ('ontouchstart' in window) {
			const vpWidth = Math.max(document.documentElement.clientWidth, window.innerWidth ?? 0);
			const vpHeight = Math.max(document.documentElement.clientHeight, window.innerHeight ?? 0);
			let start = null;

			ul.style.top = `${sb.offsetHeight}px`;
			ul.style.left = `${-rect.left}px`;
			ul.style.right = `${rect.right - vpWidth}px`;
			ul.style.maxHeight = `${vpHeight * 0.5}px`;
			ul.style.WebkitOverflowScrolling = 'touch';

			const scrollFrom = scrollParent.scrollTop;
			const scrollTo = scrollFrom + rect.top - vpHeight * 0.5;

			const scrollStep = timestamp => {
				if (!start) {
					start = timestamp;
					ul.scrollTop = sel ? Math.max(sel.offsetTop - sel.offsetHeight, 0) : 0;
				}

				const duration = Math.max(timestamp - start, 1);
				if (duration < 100) {
					scrollParent.scrollTop = scrollFrom + (scrollTo - scrollFrom) * (duration / 100);
					window.requestAnimationFrame(scrollStep);
				}
				else {
					scrollParent.scrollTop = scrollTo;
				}
			};

			window.requestAnimationFrame(scrollStep);
		}
		else {
			ul.style.maxHeight = '1px';
			ul.style.top = ul.style.bottom = '';

			window.requestAnimationFrame(() => {
				const containerRect = scrollParent.getBoundingClientRect();
				const itemHeight = li[Math.max(0, li.length - 2)].getBoundingClientRect().height;
				let fullHeight = 0;
				const spaceAbove = rect.top - containerRect.top;
				const spaceBelow = containerRect.bottom - rect.bottom;

				for (let i = 0; i < (items == -1 ? li.length : items); i++)
					fullHeight += li[i].getBoundingClientRect().height;

				if (fullHeight <= spaceBelow) {
					ul.style.top = `${rect.height}px`;
					ul.style.maxHeight = `${spaceBelow}px`;
				}
				else if (fullHeight <= spaceAbove) {
					ul.style.bottom = `${rect.height}px`;
					ul.style.maxHeight = `${spaceAbove}px`;
				}
				else if (spaceBelow >= spaceAbove) {
					ul.style.top = `${rect.height}px`;
					ul.style.maxHeight = `${spaceBelow - (spaceBelow % itemHeight)}px`;
				}
				else {
					ul.style.bottom = `${rect.height}px`;
					ul.style.maxHeight = `${spaceAbove - (spaceAbove % itemHeight)}px`;
				}

				ul.scrollTop = sel ? Math.max(sel.offsetTop - sel.offsetHeight, 0) : 0;
			});
		}

		const cboxes = ul.querySelectorAll('[selected] input[type="checkbox"]');
		for (let i = 0; i < cboxes.length; i++) {
			cboxes[i].checked = true;
			cboxes[i].disabled = (cboxes.length == 1 && !this.options.optional);
		}

		ul.classList.add('dropdown');

		sb.insertBefore(pv, ul.nextElementSibling);

		li.forEach(l => {
			if (!l.hasAttribute('unselectable'))
				l.setAttribute('tabindex', 0);
		});

		sb.lastElementChild.setAttribute('tabindex', 0);

		const focusFn = L.bind((el) => {
			this.setFocus(sb, el, true);
			ul.removeEventListener('transitionend', focusFn);
		}, this, sel ?? li[0]);

		ul.addEventListener('transitionend', focusFn);
	},

	/** @private */
	closeDropdown(sb, no_focus) {
		if (!sb.hasAttribute('open'))
			return;

		const pv = sb.querySelector('ul.preview');
		const ul = sb.querySelector('ul.dropdown');
		const li = ul.querySelectorAll('li');
		const fl = findParent(sb, '.cbi-value-field');

		li.forEach(l => l.removeAttribute('tabindex'));
		sb.lastElementChild.removeAttribute('tabindex');

		sb.removeChild(pv);
		sb.removeAttribute('open');
		sb.style.width = sb.style.height = '';

		ul.classList.remove('dropdown');
		ul.style.top = ul.style.bottom = ul.style.maxHeight = '';

		if (fl)
			fl.classList.remove('cbi-dropdown-open');

		if (!no_focus)
			this.setFocus(sb, sb);

		this.saveValues(sb, ul);
	},

	/** @private */
	toggleItem(sb, li, force_state) {
		const ul = li.parentNode;

		if (li.hasAttribute('unselectable'))
			return;

		if (this.options.multiple) {
			const cbox = li.querySelector('input[type="checkbox"]');
			const items = li.parentNode.querySelectorAll('li');
			const label = sb.querySelector('ul.preview');
			let sel = li.parentNode.querySelectorAll('[selected]').length;
			const more = sb.querySelector('.more');
			let ndisplay = this.options.display_items;
			let n = 0;

			if (li.hasAttribute('selected')) {
				if (force_state !== true) {
					if (sel > 1 || this.options.optional) {
						li.removeAttribute('selected');
						cbox.checked = cbox.disabled = false;
						sel--;
					}
					else {
						cbox.disabled = true;
					}
				}
			}
			else {
				if (force_state !== false) {
					li.setAttribute('selected', '');
					cbox.checked = true;
					cbox.disabled = false;
					sel++;
				}
			}

			while (label && label.firstElementChild)
				label.removeChild(label.firstElementChild);

			for (let i = 0; i < items.length; i++) {
				items[i].removeAttribute('display');
				if (items[i].hasAttribute('selected')) {
					if (ndisplay-- > 0) {
						items[i].setAttribute('display', n++);
						if (label)
							label.appendChild(items[i].cloneNode(true));
					}
					const c = items[i].querySelector('input[type="checkbox"]');
					if (c)
						c.disabled = (sel == 1 && !this.options.optional);
				}
			}

			if (ndisplay < 0)
				sb.setAttribute('more', '');
			else
				sb.removeAttribute('more');

			if (ndisplay === this.options.display_items)
				sb.setAttribute('empty', '');
			else
				sb.removeAttribute('empty');

			dom.content(more, (ndisplay === this.options.display_items)
				? (this.options.select_placeholder ?? this.options.placeholder) : '···');
		}
		else {
			let sel = li.parentNode.querySelector('[selected]');
			if (sel) {
				sel.removeAttribute('display');
				sel.removeAttribute('selected');
			}

			li.setAttribute('display', 0);
			li.setAttribute('selected', '');

			this.closeDropdown(sb);
		}

		this.saveValues(sb, ul);
	},

	/** @private */
	transformItem(sb, li) {
		const cbox = E('form', {}, E('input', { type: 'checkbox', tabindex: -1, onclick: 'event.preventDefault()' }));
		const label = E('label');

		while (li.firstChild)
			label.appendChild(li.firstChild);

		li.appendChild(cbox);
		li.appendChild(label);
	},

	/** @private */
	saveValues(sb, ul) {
		const sel = ul.querySelectorAll('li[selected]');
		const div = sb.lastElementChild;
		const name = this.options.name;
		let strval = '';
		const values = [];

		while (div.lastElementChild)
			div.removeChild(div.lastElementChild);

		sel.forEach(s => {
			if (s.hasAttribute('placeholder'))
				return;

			const v = {
				text: s.innerText,
				value: s.hasAttribute('data-value') ? s.getAttribute('data-value') : s.innerText,
				element: s
			};

			div.appendChild(E('input', {
				type: 'hidden',
				name: name,
				value: v.value
			}));

			values.push(v);

			strval += strval.length ? ` ${v.value}` : v.value;
		});

		const detail = {
			instance: this,
			element: sb
		};

		if (this.options.multiple)
			detail.values = values;
		else
			detail.value = values.length ? values[0] : null;

		sb.value = strval;

		sb.dispatchEvent(new CustomEvent('cbi-dropdown-change', {
			bubbles: true,
			detail: detail
		}));
	},

	/** @private */
	setValues(sb, values) {
		const ul = sb.querySelector('ul');

		if (this.options.create) {
			for (const value in values) {
				this.createItems(sb, value);

				if (!this.options.multiple)
					break;
			}
		}

		if (this.options.multiple) {
			const lis = ul.querySelectorAll('li[data-value]');
			for (let i = 0; i < lis.length; i++) {
				const value = lis[i].getAttribute('data-value');
				if (values === null || !(value in values))
					this.toggleItem(sb, lis[i], false);
				else
					this.toggleItem(sb, lis[i], true);
			}
		}
		else {
			const ph = ul.querySelector('li[placeholder]');
			if (ph)
				this.toggleItem(sb, ph);

			const lis = ul.querySelectorAll('li[data-value]');
			for (let i = 0; i < lis.length; i++) {
				const value = lis[i].getAttribute('data-value');
				if (values !== null && (value in values))
					this.toggleItem(sb, lis[i]);
			}
		}
	},

	/** @private */
	setFocus(sb, elem, scroll) {
		if (sb.hasAttribute('locked-in'))
			return;

		sb.querySelectorAll('.focus').forEach(e => {
			e.classList.remove('focus');
		});

		elem.classList.add('focus');

		if (scroll)
			elem.parentNode.scrollTop = elem.offsetTop - elem.parentNode.offsetTop;

		elem.focus();
	},

	/** @private */
	handleMouseout(ev) {
		const sb = ev.currentTarget;

		if (!sb.hasAttribute('open'))
			return;

		sb.querySelectorAll('.focus').forEach(e => {
			e.classList.remove('focus');
		});

		sb.querySelector('ul.dropdown').focus();
	},

	/** @private */
	createChoiceElement(sb, value, label) {
		const tpl = sb.querySelector(this.options.create_template);
		let markup = null;

		if (tpl)
			markup = (tpl.textContent ?? tpl.innerHTML ?? tpl.firstChild.data).replace(/^<!--|--!?>$/g, '').trim();
		else
			markup = '<li data-value="{{value}}"><span data-label-placeholder="true" /></li>';

		const new_item = E(markup.replace(/{{value}}/g, '%h'.format(value)));
		const placeholder = new_item.querySelector('[data-label-placeholder]');

		if (placeholder) {
			const content = E('span', {}, label ?? this.choices[value] ?? [ value ]);

			while (content.firstChild)
				placeholder.parentNode.insertBefore(content.firstChild, placeholder);

			placeholder.parentNode.removeChild(placeholder);
		}

		if (this.options.multiple)
			this.transformItem(sb, new_item);

		if (!new_item.hasAttribute('unselectable'))
			new_item.setAttribute('tabindex', 0);

		return new_item;
	},

	/** @private */
	createItems(sb, value) {
		const sbox = this;
		let val = (value ?? '').trim();
		const ul = sb.querySelector('ul');

		if (!sbox.options.multiple)
			val = val.length ? [ val ] : [];
		else
			val = val.length ? val.split(/\s+/) : [];

		val.forEach(item => {
			let new_item = null;

			ul.childNodes.forEach(li => {
				if (li.getAttribute && li.getAttribute('data-value') === item)
					new_item = li;
			});

			if (!new_item) {
				new_item = sbox.createChoiceElement(sb, item);

				if (!sbox.options.multiple) {
					const old = ul.querySelector('li[created]');
					if (old)
						ul.removeChild(old);

					new_item.setAttribute('created', '');
				}

				new_item = ul.insertBefore(new_item, ul.lastElementChild);
			}

			sbox.toggleItem(sb, new_item, true);
			sbox.setFocus(sb, new_item, true);
		});
	},

	/**
	 * Remove all existing choices from the dropdown menu.
	 *
	 * This function removes all preexisting dropdown choices from the widget,
	 * keeping only choices currently being selected unless `reset_values` is
	 * given, in which case all choices and deselected and removed.
	 *
	 * @instance
	 * @memberof LuCI.ui.Dropdown
	 * @param {boolean} [reset_value=false]
	 * If set to `true`, deselect and remove selected choices as well instead
	 * of keeping them.
	 */
	clearChoices(reset_value) {
		const ul = this.node.querySelector('ul');
		const lis = ul ? ul.querySelectorAll('li[data-value]') : [];
		const len = lis.length - (this.options.create ? 1 : 0);
		const val = reset_value ? null : this.getValue();

		for (let i = 0; i < len; i++) {
			const lival = lis[i].getAttribute('data-value');
			if (val == null ||
				(!this.options.multiple && val != lival) ||
				(this.options.multiple && val.indexOf(lival) == -1))
				ul.removeChild(lis[i]);
		}

		if (reset_value)
			this.setValues(this.node, {});
	},

	/**
	 * Add new choices to the dropdown menu.
	 *
	 * This function adds further choices to an existing dropdown menu,
	 * ignoring choice values which are already present.
	 *
	 * @instance
	 * @memberof LuCI.ui.Dropdown
	 * @param {string[]} values
	 * The choice values to add to the dropdown widget.
	 *
	 * @param {Object<string, *>} labels
	 * The choice label values to use when adding dropdown choices. If no
	 * label is found for a particular choice value, the value itself is used
	 * as label text. Choice labels may be any valid value accepted by
	 * {@link LuCI.dom#content}.
	 */
	addChoices(values, labels) {
		const sb = this.node;
		const ul = sb.querySelector('ul');
		const lis = ul ? ul.querySelectorAll('li[data-value]') : [];

		if (!Array.isArray(values))
			values = L.toArray(values);

		if (!L.isObject(labels))
			labels = {};

		for (let i = 0; i < values.length; i++) {
			let found = false;

			for (let j = 0; j < lis.length; j++) {
				if (lis[j].getAttribute('data-value') === values[i]) {
					found = true;
					break;
				}
			}

			if (found)
				continue;

			ul.insertBefore(
				this.createChoiceElement(sb, values[i], labels[values[i]]),
				ul.lastElementChild);
		}
	},

	/**
	 * Close all open dropdown widgets in the current document.
	 */
	closeAllDropdowns() {
		document.querySelectorAll('.cbi-dropdown[open]').forEach(s => {
			s.dispatchEvent(new CustomEvent('cbi-dropdown-close', {}));
		});
	},

	/** @private */
	handleClick(ev) {
		const sb = ev.currentTarget;

		if (!sb.hasAttribute('open')) {
			if (!matchesElem(ev.target, 'input'))
				this.openDropdown(sb);
		}
		else {
			const li = findParent(ev.target, 'li');
			if (li && li.parentNode.classList.contains('dropdown'))
				this.toggleItem(sb, li);
			else if (li && li.parentNode.classList.contains('preview'))
				this.closeDropdown(sb);
			else if (matchesElem(ev.target, 'span.open, span.more'))
				this.closeDropdown(sb);
		}

		ev.preventDefault();
		ev.stopPropagation();
	},

	/** @private */
	handleKeydown(ev) {
		const sb = ev.currentTarget;
		const ul = sb.querySelector('ul.dropdown');

		if (matchesElem(ev.target, 'input'))
			return;

		if (!sb.hasAttribute('open')) {
			switch (ev.keyCode) {
			case 37:
			case 38:
			case 39:
			case 40:
				this.openDropdown(sb);
				ev.preventDefault();
			}
		}
		else {
			const active = findParent(document.activeElement, 'li');

			switch (ev.keyCode) {
			case 27:
				this.closeDropdown(sb);
				ev.stopPropagation();
				break;

			case 13:
				if (active) {
					if (!active.hasAttribute('selected'))
						this.toggleItem(sb, active);
					this.closeDropdown(sb);
					ev.preventDefault();
				}
				break;

			case 32:
				if (active) {
					this.toggleItem(sb, active);
					ev.preventDefault();
				}
				break;

			case 38:
				if (active && active.previousElementSibling) {
					this.setFocus(sb, active.previousElementSibling);
					ev.preventDefault();
				}
				else if (document.activeElement === ul) {
					this.setFocus(sb, ul.lastElementChild);
					ev.preventDefault();
				}
				break;

			case 40:
				if (active && active.nextElementSibling) {
					const li = active.nextElementSibling;
					this.setFocus(sb, li);
					if (this.options.create && li == li.parentNode.lastElementChild) {
						const input = li.querySelector('input:not([type="hidden"]):not([type="checkbox"]');
						if (input) input.focus();
					}
					ev.preventDefault();
				}
				else if (document.activeElement === ul) {
					this.setFocus(sb, ul.firstElementChild);
					ev.preventDefault();
				}
				break;
			}
		}
	},

	/** @private */
	handleDropdownClose(ev) {
		const sb = ev.currentTarget;

		this.closeDropdown(sb, true);
	},

	/** @private */
	handleDropdownSelect(ev) {
		const sb = ev.currentTarget;
		const li = findParent(ev.target, 'li');

		if (!li)
			return;

		this.toggleItem(sb, li);
		this.closeDropdown(sb, true);
	},

	/** @private */
	handleMouseover(ev) {
		const sb = ev.currentTarget;

		if (!sb.hasAttribute('open'))
			return;

		const li = findParent(ev.target, 'li');

		if (li && li.parentNode.classList.contains('dropdown'))
			this.setFocus(sb, li);
	},

	/** @private */
	handleFocus(ev) {
		const sb = ev.currentTarget;

		document.querySelectorAll('.cbi-dropdown[open]').forEach(s => {
			if (s !== sb || sb.hasAttribute('open'))
				s.dispatchEvent(new CustomEvent('cbi-dropdown-close', {}));
		});
	},

	/** @private */
	handleCanaryFocus(ev) {
		this.closeDropdown(ev.currentTarget.parentNode);
	},

	/** @private */
	handleCreateKeydown(ev) {
		const input = ev.currentTarget;
		const li = findParent(input, 'li');
		const sb = findParent(li, '.cbi-dropdown');

		switch (ev.keyCode) {
		case 13:
			ev.preventDefault();

			if (input.classList.contains('cbi-input-invalid'))
				return;

			this.handleCreateBlur(ev);
			this.createItems(sb, input.value);
			input.value = '';
			break;

		case 27:
			this.handleCreateBlur(ev);
			this.closeDropdown(sb);
			ev.stopPropagation();
			input.value = '';
			break;

		case 38:
			if (li.previousElementSibling) {
				this.handleCreateBlur(ev);
				this.setFocus(sb, li.previousElementSibling, true);
			}
			break;
		}
	},

	/** @private */
	handleCreateFocus(ev) {
		const input = ev.currentTarget;
		const li = findParent(input, 'li');
		const cbox = li.querySelector('input[type="checkbox"]');
		const sb = findParent(input, '.cbi-dropdown');

		if (cbox)
			cbox.checked = true;

		sb.setAttribute('locked-in', '');
		this.setFocus(sb, li, true);
	},

	/** @private */
	handleCreateBlur(ev) {
		const input = ev.currentTarget;
		const cbox = findParent(input, 'li').querySelector('input[type="checkbox"]');
		const sb = findParent(input, '.cbi-dropdown');

		if (cbox)
			cbox.checked = false;

		sb.removeAttribute('locked-in');
	},

	/** @private */
	handleCreateClick(ev) {
		ev.currentTarget.querySelector(this.options.create_query).focus();
	},

	/** @override */
	setValue(values) {
		if (this.options.multiple) {
			if (!Array.isArray(values))
				values = (values != null && values != '') ? [ values ] : [];

			const v = {};

			for (let i = 0; i < values.length; i++)
				v[values[i]] = true;

			this.setValues(this.node, v);
		}
		else {
			const v = {};

			if (values != null) {
				if (Array.isArray(values))
					v[values[0]] = true;
				else
					v[values] = true;
			}

			this.setValues(this.node, v);
		}
	},

	/** @override */
	getValue() {
		const div = this.node.lastElementChild;
		const h = div.querySelectorAll('input[type="hidden"]');
		const v = [];

		for (let i = 0; i < h.length; i++)
			v.push(h[i].value);

		return this.options.multiple ? v : v[0];
	}
});

/**
 * Instantiate a rich dropdown choice widget allowing custom values.
 *
 * @constructor Combobox
 * @memberof LuCI.ui
 * @augments LuCI.ui.Dropdown
 *
 * @classdesc
 *
 * The `Combobox` class implements a rich, stylable dropdown menu which allows
 * to enter custom values. Historically, comboboxes used to be a dedicated
 * widget type in LuCI but nowadays they are direct aliases of dropdown widgets
 * with a set of enforced default properties for easier instantiation.
 *
 * UI widget instances are usually not supposed to be created by view code
 * directly, instead they're implicitly created by `LuCI.form` when
 * instantiating CBI forms.
 *
 * This class is automatically instantiated as part of `LuCI.ui`. To use it
 * in views, use `'require ui'` and refer to `ui.Combobox`. To import it in
 * external JavaScript, use `L.require("ui").then(...)` and access the
 * `Combobox` property of the class instance value.
 *
 * @param {string|string[]} [value=null]
 * The initial input value(s).
 *
 * @param {Object<string, *>} choices
 * Object containing the selectable choices of the widget. The object keys
 * serve as values for the different choices while the values are used as
 * choice labels.
 *
 * @param {LuCI.ui.Combobox.InitOptions} [options]
 * Object describing the widget specific options to initialize the dropdown.
 */
const UICombobox = UIDropdown.extend(/** @lends LuCI.ui.Combobox.prototype */ {
	/**
	 * Comboboxes support the same properties as
	 * [Dropdown.InitOptions]{@link LuCI.ui.Dropdown.InitOptions} but enforce
	 * specific values for the following properties:
	 *
	 * @typedef {LuCI.ui.Dropdown.InitOptions} InitOptions
	 * @memberof LuCI.ui.Combobox
	 *
	 * @property {boolean} multiple=false
	 * Since Comboboxes never allow selecting multiple values, this property
	 * is forcibly set to `false`.
	 *
	 * @property {boolean} create=true
	 * Since Comboboxes always allow custom choice values, this property is
	 * forcibly set to `true`.
	 *
	 * @property {boolean} optional=true
	 * Since Comboboxes are always optional, this property is forcibly set to
	 * `true`.
	 */
	__init__(value, choices, options) {
		this.super('__init__', [ value, choices, Object.assign({
			select_placeholder: _('-- Please choose --'),
			custom_placeholder: _('-- custom --'),
			dropdown_items: -1,
			sort: true
		}, options, {
			multiple: false,
			create: true,
			optional: true
		}) ]);
	}
});

/**
 * Instantiate a combo button widget offering multiple action choices.
 *
 * @constructor ComboButton
 * @memberof LuCI.ui
 * @augments LuCI.ui.Dropdown
 *
 * @classdesc
 *
 * The `ComboButton` class implements a button element which can be expanded
 * into a dropdown to chose from a set of different action choices.
 *
 * UI widget instances are usually not supposed to be created by view code
 * directly, instead they're implicitly created by `LuCI.form` when
 * instantiating CBI forms.
 *
 * This class is automatically instantiated as part of `LuCI.ui`. To use it
 * in views, use `'require ui'` and refer to `ui.ComboButton`. To import it in
 * external JavaScript, use `L.require("ui").then(...)` and access the
 * `ComboButton` property of the class instance value.
 *
 * @param {string|string[]} [value=null]
 * The initial input value(s).
 *
 * @param {Object<string, *>} choices
 * Object containing the selectable choices of the widget. The object keys
 * serve as values for the different choices while the values are used as
 * choice labels.
 *
 * @param {LuCI.ui.ComboButton.InitOptions} [options]
 * Object describing the widget specific options to initialize the button.
 */
const UIComboButton = UIDropdown.extend(/** @lends LuCI.ui.ComboButton.prototype */ {
	/**
	 * ComboButtons support the same properties as
	 * [Dropdown.InitOptions]{@link LuCI.ui.Dropdown.InitOptions} but enforce
	 * specific values for some properties and add additional button specific
	 * properties.
	 *
	 * @typedef {LuCI.ui.Dropdown.InitOptions} InitOptions
	 * @memberof LuCI.ui.ComboButton
	 *
	 * @property {boolean} multiple=false
	 * Since ComboButtons never allow selecting multiple actions, this property
	 * is forcibly set to `false`.
	 *
	 * @property {boolean} create=false
	 * Since ComboButtons never allow creating custom choices, this property
	 * is forcibly set to `false`.
	 *
	 * @property {boolean} optional=false
	 * Since ComboButtons must always select one action, this property is
	 * forcibly set to `false`.
	 *
	 * @property {Object<string, string>} [classes]
	 * Specifies a mapping of choice values to CSS class names. If an action
	 * choice is selected by the user and if a corresponding entry exists in
	 * the `classes` object, the class names corresponding to the selected
	 * value are set on the button element.
	 *
	 * This is useful to apply different button styles, such as colors, to the
	 * combined button depending on the selected action.
	 *
	 * @property {function} [click]
	 * Specifies a handler function to invoke when the user clicks the button.
	 * This function will be called with the button DOM node as `this` context
	 * and receive the DOM click event as first as well as the selected action
	 * choice value as second argument.
	 */
	__init__(value, choices, options) {
		this.super('__init__', [ value, choices, Object.assign({
			sort: true
		}, options, {
			multiple: false,
			create: false,
			optional: false
		}) ]);
	},

	/** @override */
	render(...args) {
		const node = UIDropdown.prototype.render.call(this, ...args);
		const val = this.getValue();

		if (L.isObject(this.options.classes) && this.options.classes.hasOwnProperty(val))
			node.setAttribute('class', `cbi-dropdown ${this.options.classes[val]}`);

		return node;
	},

	/** @private */
	handleClick(ev, ...args) {
		const sb = ev.currentTarget;
		const t = ev.target;

		if (sb.hasAttribute('open') || dom.matches(t, '.cbi-dropdown > span.open'))
			return UIDropdown.prototype.handleClick.call(this, ev, ...args);

		if (this.options.click)
			return this.options.click.call(sb, ev, this.getValue());
	},

	/** @private */
	toggleItem(sb, ...args) {
		const rv = UIDropdown.prototype.toggleItem.call(this, sb, ...args);
		const val = this.getValue();

		if (L.isObject(this.options.classes) && this.options.classes.hasOwnProperty(val))
			sb.setAttribute('class', `cbi-dropdown ${this.options.classes[val]}`);
		else
			sb.setAttribute('class', 'cbi-dropdown');

		return rv;
	}
});

/**
 * Instantiate a dynamic list widget.
 *
 * @constructor DynamicList
 * @memberof LuCI.ui
 * @augments LuCI.ui.AbstractElement
 *
 * @classdesc
 *
 * The `DynamicList` class implements a widget which allows the user to specify
 * an arbitrary amount of input values, either from free formed text input or
 * from a set of predefined choices.
 *
 * UI widget instances are usually not supposed to be created by view code
 * directly, instead they're implicitly created by `LuCI.form` when
 * instantiating CBI forms.
 *
 * This class is automatically instantiated as part of `LuCI.ui`. To use it
 * in views, use `'require ui'` and refer to `ui.DynamicList`. To import it in
 * external JavaScript, use `L.require("ui").then(...)` and access the
 * `DynamicList` property of the class instance value.
 *
 * @param {string|string[]} [value=null]
 * The initial input value(s).
 *
 * @param {Object<string, *>} [choices]
 * Object containing the selectable choices of the widget. The object keys
 * serve as values for the different choices while the values are used as
 * choice labels. If omitted, no default choices are presented to the user,
 * instead a plain text input field is rendered allowing the user to add
 * arbitrary values to the dynamic list.
 *
 * @param {LuCI.ui.DynamicList.InitOptions} [options]
 * Object describing the widget specific options to initialize the dynamic list.
 */
const UIDynamicList = UIElement.extend(/** @lends LuCI.ui.DynamicList.prototype */ {
	/**
	 * In case choices are passed to the dynamic list constructor, the widget
	 * supports the same properties as [Dropdown.InitOptions]{@link LuCI.ui.Dropdown.InitOptions}
	 * but enforces specific values for some dropdown properties.
	 *
	 * @typedef {LuCI.ui.Dropdown.InitOptions} InitOptions
	 * @memberof LuCI.ui.DynamicList
	 *
	 * @property {boolean} multiple=false
	 * Since dynamic lists never allow selecting multiple choices when adding
	 * another list item, this property is forcibly set to `false`.
	 *
	 * @property {boolean} optional=true
	 * Since dynamic lists use an embedded dropdown to present a list of
	 * predefined choice values, the dropdown must be made optional to allow
	 * it to remain unselected.
	 */
	__init__(values, choices, options) {
		if (!Array.isArray(values))
			values = (values != null && values != '') ? [ values ] : [];

		if (typeof(choices) != 'object')
			choices = null;

		this.values = values;
		this.choices = choices;
		this.options = Object.assign({}, options, {
			multiple: false,
			optional: true
		});
	},

	/** @override */
	render() {
		const dl = E('div', {
			'id': this.options.id,
			'class': 'cbi-dynlist',
			'disabled': this.options.disabled ? '' : null
		}, E('div', { 'class': 'add-item control-group' }));

		if (this.choices) {
			if (this.options.placeholder != null)
				this.options.select_placeholder = this.options.placeholder;

			const cbox = new UICombobox(null, this.choices, this.options);

			dl.lastElementChild.appendChild(cbox.render());
		}
		else {
			const inputEl = E('input', {
				'id': this.options.id ? `widget.${this.options.id}` : null,
				'type': 'text',
				'class': 'cbi-input-text',
				'placeholder': this.options.placeholder,
				'disabled': this.options.disabled ? '' : null
			});

			dl.lastElementChild.appendChild(inputEl);
			dl.lastElementChild.appendChild(E('div', { 'class': 'btn cbi-button cbi-button-add' }, '+'));

			if (this.options.datatype || this.options.validate)
				UI.prototype.addValidator(inputEl, this.options.datatype ?? 'string',
				                          true, this.options.validate, 'blur', 'keyup');
		}

		for (let i = 0; i < this.values.length; i++) {
			let label = this.choices ? this.choices[this.values[i]] : null;

			if (dom.elem(label))
				label = label.cloneNode(true);

			this.addItem(dl, this.values[i], label);
		}

		this.initDragAndDrop(dl);

		return this.bind(dl);
	},

	/** @private */
	initDragAndDrop(dl) {
		let draggedItem = null;
		let placeholder = null;

		dl.addEventListener('dragstart', (e) => {
			if (e.target.classList.contains('item')) {
				draggedItem = e.target;
				e.target.classList.add('dragging');
			}
		});

		dl.addEventListener('dragend', (e) => e.target.classList.remove('dragging'));

		dl.addEventListener('dragover', (e) => e.preventDefault());

		dl.addEventListener('dragenter', (e) => e.target.classList.add('drag-over'));

		dl.addEventListener('dragleave', (e) => e.target.classList.remove('drag-over'));

		dl.addEventListener('drop', (e) => {
			e.preventDefault();
			e.target.classList.remove('drag-over');
			const target = e.target.classList.contains('item') ? e.target : dl.querySelector('.add-item');
			dl.insertBefore(draggedItem, target);
			this.dispatchCbiDynlistChange(dl, draggedItem.value);
		});

		dl.addEventListener('click', (e) => {
			if (e.target.closest('.item')) {
				const span = e.target.closest('.item').querySelector('SPAN');
				if (span) {
					const range = document.createRange();
					range.selectNodeContents(span);
					const selection = window.getSelection();
					if (selection.rangeCount === 0 || selection.toString().length === 0) {
						selection.removeAllRanges();
						selection.addRange(range);
					} else selection.removeAllRanges();
				}
			}
		});

		dl.addEventListener('touchstart', (e) => {
			const touch = e.touches[0];
			const target = e.target.closest('.item');
			if (target) {
				draggedItem = target;

				placeholder = draggedItem.cloneNode(true);
				placeholder.className = 'placeholder';
				placeholder.style.height = `${draggedItem.offsetHeight}px`;
				draggedItem.parentNode.insertBefore(placeholder, draggedItem.nextSibling);
				draggedItem.classList.add('dragging')
			}
		});

		dl.addEventListener('touchmove', (e) => {
			if (draggedItem) {
				const touch = e.touches[0];
				const currentY = touch.clientY;

				const items = Array.from(dl.querySelectorAll('.item'));
				const target = items.find(item => {
					const rect = item.getBoundingClientRect();
					return currentY > rect.top && currentY < rect.bottom;
				});

				if (target && target !== draggedItem) {
					const insertBefore = currentY < target.getBoundingClientRect().top + target.offsetHeight / 2;
					dl.insertBefore(placeholder, insertBefore ? target : target.nextSibling);
				}

				e.preventDefault();
			}
		});

		dl.addEventListener('touchend', (e) => {
			if (draggedItem && placeholder) {
				dl.insertBefore(draggedItem, placeholder);
				draggedItem.classList.remove('dragging')
				placeholder.parentNode.removeChild(placeholder);
				this.dispatchCbiDynlistChange(dl, draggedItem.value);
				placeholder = null;
				draggedItem = null;
			}
		});
	},

	/** @private */
	bind(dl) {
		dl.addEventListener('click', L.bind(this.handleClick, this));
		dl.addEventListener('keydown', L.bind(this.handleKeydown, this));
		dl.addEventListener('cbi-dropdown-change', L.bind(this.handleDropdownChange, this));

		this.node = dl;

		this.setUpdateEvents(dl, 'cbi-dynlist-change');
		this.setChangeEvents(dl, 'cbi-dynlist-change');

		dom.bindClassInstance(dl, this);

		return dl;
	},

	/** @private */
	addItem(dl, value, text, flash) {
		let exists = false;

		const new_item = E('div', { 'class': flash ? 'item flash' : 'item', 'tabindex': 0, 'draggable': true }, [
			E('span', {}, [ text ?? value ]),
			E('input', {
				'type': 'hidden',
				'name': this.options.name,
				'value': value })]);

		dl.querySelectorAll('.item').forEach(item => {
			if (exists)
				return;

			let hidden = item.querySelector('input[type="hidden"]');

			if (hidden && hidden.parentNode !== item)
				hidden = null;

			if (hidden && hidden.value === value)
				exists = true;
		});

		if (this.options.allowduplicates || !exists) {
			const ai = dl.querySelector('.add-item');
			ai.parentNode.insertBefore(new_item, ai);
		}

		this.dispatchCbiDynlistChange(dl,value);
	},

	/** @private */
	dispatchCbiDynlistChange(dl,value) {
		dl.dispatchEvent(new CustomEvent('cbi-dynlist-change', {
			bubbles: true,
			detail: {
				instance: this,
				element: dl,
				value: value,
				add: true
			}
		}));
	},

	/** @private */
	removeItem(dl, item) {
		const value = item.querySelector('input[type="hidden"]').value;
		const sb = dl.querySelector('.cbi-dropdown');
		if (sb)
			sb.querySelectorAll('ul > li').forEach(li => {
				if (li.getAttribute('data-value') === value) {
					if (li.hasAttribute('dynlistcustom'))
						li.parentNode.removeChild(li);
					else
						li.removeAttribute('unselectable');
				}
			});

		item.parentNode.removeChild(item);

		this.dispatchCbiDynlistChange(dl, value);
	},

	/** @private */
	handleClick(ev) {
		const dl = ev.currentTarget;
		const item = findParent(ev.target, '.item');

		if (this.options.disabled)
			return;

		if (item) {
			// Get bounding rectangle of the item
			const rect = item.getBoundingClientRect();

			// Get computed styles for the ::after pseudo-element
			const afterStyles = window.getComputedStyle(item, '::after');
			const afterWidth = parseFloat(afterStyles.width) || 0;

			// Check if the click is within the ::after region
			if (rect.right - ev.clientX <= afterWidth) {
				this.removeItem(dl, item);
			}
		}
		else if (matchesElem(ev.target, '.cbi-button-add')) {
			const input = ev.target.previousElementSibling;
			if (input.value.length && !input.classList.contains('cbi-input-invalid')) {
				this.addItem(dl, input.value, null, true);
				input.value = '';
			}
		}
	},

	/** @private */
	handleDropdownChange(ev) {
		const dl = ev.currentTarget;
		const sbIn = ev.detail.instance;
		const sbEl = ev.detail.element;
		const sbVal = ev.detail.value;

		if (sbVal === null)
			return;

		sbIn.setValues(sbEl, null);
		if (!this.options.allowduplicates)
			sbVal.element.setAttribute('unselectable', '');

		if (sbVal.element.hasAttribute('created')) {
			sbVal.element.removeAttribute('created');
			sbVal.element.setAttribute('dynlistcustom', '');
		}

		let label = sbVal.text;

		if (sbVal.element) {
			label = E([]);

			for (let i = 0; i < sbVal.element.childNodes.length; i++)
				label.appendChild(sbVal.element.childNodes[i].cloneNode(true));
		}

		this.addItem(dl, sbVal.value, label, true);
	},

	/** @private */
	handleKeydown(ev) {
		const dl = ev.currentTarget;
		const item = findParent(ev.target, '.item');

		if (item) {
			switch (ev.keyCode) {
			case 8: /* backspace */
				if (item.previousElementSibling)
					item.previousElementSibling.focus();

				this.removeItem(dl, item);
				break;

			case 46: /* delete */
				if (item.nextElementSibling) {
					if (item.nextElementSibling.classList.contains('item'))
						item.nextElementSibling.focus();
					else
						item.nextElementSibling.firstElementChild.focus();
				}

				this.removeItem(dl, item);
				break;
			}
		}
		else if (matchesElem(ev.target, '.cbi-input-text')) {
			switch (ev.keyCode) {
			case 13: /* enter */
				if (ev.target.value.length && !ev.target.classList.contains('cbi-input-invalid')) {
					this.addItem(dl, ev.target.value, null, true);
					ev.target.value = '';
					ev.target.blur();
					ev.target.focus();
				}

				ev.preventDefault();
				break;
			}
		}
	},

	/** @override */
	getValue() {
		const items = this.node.querySelectorAll('.item > input[type="hidden"]');
		const input = this.node.querySelector('.add-item > input[type="text"]');
		const v = [];

		for (let i = 0; i < items.length; i++)
			v.push(items[i].value);

		if (input && input.value != null && input.value.match(/\S/) &&
		    input.classList.contains('cbi-input-invalid') == false &&
		    v.filter(s => s == input.value).length == 0)
			v.push(input.value);

		return v;
	},

	/** @override */
	setValue(values) {
		if (!Array.isArray(values))
			values = (values != null && values != '') ? [ values ] : [];

		const items = this.node.querySelectorAll('.item');

		for (let i = 0; i < items.length; i++)
			if (items[i].parentNode === this.node)
				this.removeItem(this.node, items[i]);

		for (let i = 0; i < values.length; i++)
			this.addItem(this.node, values[i],
				this.choices ? this.choices[values[i]] : null);
	},

	/**
	 * Add new suggested choices to the dynamic list.
	 *
	 * This function adds further choices to an existing dynamic list,
	 * ignoring choice values which are already present.
	 *
	 * @instance
	 * @memberof LuCI.ui.DynamicList
	 * @param {string[]} values
	 * The choice values to add to the dynamic lists suggestion dropdown.
	 *
	 * @param {Object<string, *>} labels
	 * The choice label values to use when adding suggested choices. If no
	 * label is found for a particular choice value, the value itself is used
	 * as label text. Choice labels may be any valid value accepted by
	 * {@link LuCI.dom#content}.
	 */
	addChoices(values, labels) {
		const dl = this.node.lastElementChild.firstElementChild;
		dom.callClassMethod(dl, 'addChoices', values, labels);
	},

	/**
	 * Remove all existing choices from the dynamic list.
	 *
	 * This function removes all preexisting suggested choices from the widget.
	 *
	 * @instance
	 * @memberof LuCI.ui.DynamicList
	 */
	clearChoices() {
		const dl = this.node.lastElementChild.firstElementChild;
		dom.callClassMethod(dl, 'clearChoices');
	}
});

/**
 * Instantiate a range slider widget.
 *
 * @constructor Slider
 * @memberof LuCI.ui
 * @augments LuCI.ui.AbstractElement
 *
 * @classdesc
 *
 * The `RangeSlider` class implements a widget which allows the user to set a 
 * value from a predefined range.
 *
 * UI widget instances are usually not supposed to be created by view code
 * directly. Instead they're implicitly created by `LuCI.form` when
 * instantiating CBI forms.
 *
 * This class is automatically instantiated as part of `LuCI.ui`. To use it
 * in views, use `'require ui'` and refer to `ui.Slider`. To import it in
 * external JavaScript, use `L.require("ui").then(...)` and access the
 * `Slider` property of the class instance value.
 *
 * @param {string|string[]} [value=null]
 * ...
 *
 */
const UIRangeSlider = UIElement.extend({
	__init__(value, options) {
		this.value = value;
		this.options = Object.assign({
			optional: true,
			min: 0,
			max: 100,
			step: 1,
			calculate: null,
			calcunits: null,
			usecalc: false,
			disabled: false,
		}, options);
	},

	/** @override */
	render() {
		this.sliderEl = E('input', {
			'type': 'range',
			'id': this.options.id,
			'min': this.options.min,
			'max': this.options.max,
			'step': this.options.step || 'any',
			'value': this.value,
			'disabled': this.options.disabled ? '' : null
		});

		this.calculatedvalue = (typeof this.options.calculate === 'function')
			? this.options.calculate(this.value)
			: null;

		this.calcEl = E('output', { 'class': 'cbi-range-slider-calc' }, this.calculatedvalue);

		this.calcunitsEl = E('span', { 'class': 'cbi-range-slider-calc-units' }, 
			this.options.calcunits 
			? '&nbsp;' + this.options.calcunits 
			: ''
		);

		const container = E('div', { 'class': 'cbi-range-slider' }, [
			this.sliderEl,
			this.valueEl = E('output', { 'for': this.options.id, 'class': 'cbi-range-slider-value' }, this.value),
			this.calculatedvalue ? E('br') : null,
			this.calculatedvalue ? this.calcEl : null,
			this.calculatedvalue ? this.calcunitsEl : null,
		].filter(Boolean));

		this.node = container;

		this.setUpdateEvents(this.sliderEl, 'input', 'blur');
		this.setChangeEvents(this.sliderEl, 'change');

		this.sliderEl.addEventListener('input', () => {
			const val = this.sliderEl.value;
			this.valueEl.textContent = val;
			
			if (typeof this.options.calculate === 'function') {
				// update the stored calculated value, and the displayed values
				this.calculatedvalue = this.options.calculate(val);
				this.calcEl.textContent = this.calculatedvalue;
			}

			this.node.setAttribute('data-changed', true);
		});

		dom.bindClassInstance(container, this);

		return container;
	},

	/** @override */
	getValue() {
		return this.sliderEl.value;
	},

	/** @private */
	getCalculatedValue() {
		return this.calculatedvalue;
	},

	/** @override */
	setValue(value) {
		this.sliderEl.value = value;
		this.valueEl.textContent = value;

		if (typeof this.options.calculate === 'function') {
			this.calculatedvalue = this.options.calculate(value);
			this.calcEl.textContent = this.calculatedvalue;
		}
	}
});

/**
 * Instantiate a hidden input field widget.
 *
 * @constructor Hiddenfield
 * @memberof LuCI.ui
 * @augments LuCI.ui.AbstractElement
 *
 * @classdesc
 *
 * The `Hiddenfield` class implements an HTML `<input type="hidden">` field
 * which allows to store form data without exposing it to the user.
 *
 * UI widget instances are usually not supposed to be created by view code
 * directly, instead they're implicitly created by `LuCI.form` when
 * instantiating CBI forms.
 *
 * This class is automatically instantiated as part of `LuCI.ui`. To use it
 * in views, use `'require ui'` and refer to `ui.Hiddenfield`. To import it in
 * external JavaScript, use `L.require("ui").then(...)` and access the
 * `Hiddenfield` property of the class instance value.
 *
 * @param {string|string[]} [value=null]
 * The initial input value.
 *
 * @param {LuCI.ui.AbstractElement.InitOptions} [options]
 * Object describing the widget specific options to initialize the hidden input.
 */
const UIHiddenfield = UIElement.extend(/** @lends LuCI.ui.Hiddenfield.prototype */ {
	__init__(value, options) {
		this.value = value;
		this.options = Object.assign({

		}, options);
	},

	/** @override */
	render() {
		const hiddenEl = E('input', {
			'id': this.options.id,
			'type': 'hidden',
			'value': this.value
		});

		return this.bind(hiddenEl);
	},

	/** @private */
	bind(hiddenEl) {
		this.node = hiddenEl;

		dom.bindClassInstance(hiddenEl, this);

		return hiddenEl;
	},

	/** @override */
	getValue() {
		return this.node.value;
	},

	/** @override */
	setValue(value) {
		this.node.value = value;
	}
});

/**
 * Instantiate a file upload widget.
 *
 * @constructor FileUpload
 * @memberof LuCI.ui
 * @augments LuCI.ui.AbstractElement
 *
 * @classdesc
 *
 * The `FileUpload` class implements a widget which allows the user to upload,
 * browse, select and delete files beneath a predefined remote directory.
 *
 * UI widget instances are usually not supposed to be created by view code
 * directly, instead they're implicitly created by `LuCI.form` when
 * instantiating CBI forms.
 *
 * This class is automatically instantiated as part of `LuCI.ui`. To use it
 * in views, use `'require ui'` and refer to `ui.FileUpload`. To import it in
 * external JavaScript, use `L.require("ui").then(...)` and access the
 * `FileUpload` property of the class instance value.
 *
 * @param {string|string[]} [value=null]
 * The initial input value.
 *
 * @param {LuCI.ui.DynamicList.InitOptions} [options]
 * Object describing the widget specific options to initialize the file
 * upload control.
 */
const UIFileUpload = UIElement.extend(/** @lends LuCI.ui.FileUpload.prototype */ {
	/**
	 * In addition to the [AbstractElement.InitOptions]{@link LuCI.ui.AbstractElement.InitOptions}
	 * the following properties are recognized:
	 *
	 * @typedef {LuCI.ui.AbstractElement.InitOptions} InitOptions
	 * @memberof LuCI.ui.FileUpload
	 *
	 * @property {boolean} [browser=false]
	 * Use a file browser mode.
	 *
	 * @property {boolean} [show_hidden=false]
	 * Specifies whether hidden files should be displayed when browsing remote
	 * files. Note that this is not a security feature, hidden files are always
	 * present in the remote file listings received, this option merely controls
	 * whether they're displayed or not.
	 *
	 * @property {boolean} [enable_upload=true]
	 * Specifies whether the widget allows the user to upload files. If set to
	 * `false`, only existing files may be selected. Note that this is not a
	 * security feature. Whether file upload requests are accepted remotely
	 * depends on the ACL setup for the current session. This option merely
	 * controls whether the upload controls are rendered or not.
	 *
	 * @property {boolean} [enable_remove=true]
	 * Specifies whether the widget allows the user to delete remove files.
	 * If set to `false`, existing files may not be removed. Note that this is
	 * not a security feature. Whether file delete requests are accepted
	 * remotely depends on the ACL setup for the current session. This option
	 * merely controls whether the file remove controls are rendered or not.
	 *
	 * @property {boolean} [enable_download=false]
	 * Specifies whether the widget allows the user to download files.
	 *
	 * @property {string} [root_directory=/etc/luci-uploads]
	 * Specifies the remote directory the upload and file browsing actions take
	 * place in. Browsing to directories outside the root directory is
	 * prevented by the widget. Note that this is not a security feature.
	 * Whether remote directories are browsable or not solely depends on the
	 * ACL setup for the current session.
	 */
	__init__(value, options) {
		this.value = value;
		this.options = Object.assign({
			browser: false,
			show_hidden: false,
			enable_upload: true,
			enable_remove: true,
			enable_download: false,
			root_directory: '/etc/luci-uploads'
		}, options);
	},

	/** @private */
	bind(browserEl) {
		this.node = browserEl;

		this.setUpdateEvents(browserEl, 'cbi-fileupload-select', 'cbi-fileupload-cancel');
		this.setChangeEvents(browserEl, 'cbi-fileupload-select', 'cbi-fileupload-cancel');

		dom.bindClassInstance(browserEl, this);

		return browserEl;
	},

	/** @override */
	render() {
		const renderFileBrowser = L.resolveDefault(this.value != null ? fs.stat(this.value) : null).then(L.bind((stat) => {
			let label;

			if (L.isObject(stat) && stat.type != 'directory')
				this.stat = stat;

			if (this.stat != null)
				label = [ this.iconForType(this.stat.type), ' %s (%1000mB)'.format(this.truncatePath(this.stat.path), this.stat.size) ];
			else if (this.value != null)
				label = [ this.iconForType('file'), ' %s (%s)'.format(this.truncatePath(this.value), _('File not accessible')) ];
			else
				label = [ _('Select file…') ];
			let btnOpenFileBrowser = E('button', {
				'class': 'btn open-file-browser',
				'click': UI.prototype.createHandlerFn(this, 'handleFileBrowser'),
				'disabled': this.options.disabled ? '' : null
			}, label);
			const fileBrowserEl = E('div', { 'id': this.options.id }, [
				btnOpenFileBrowser,
				E('div', {
					'class': 'cbi-filebrowser'
				}),
				E('input', {
					'type': 'hidden',
					'name': this.options.name,
					'value': this.value
				})
			]);
			return this.bind(fileBrowserEl);
		}, this));
		// in a browser mode open dir listing after render by clicking on a Select button
		if (this.options.browser) {
			return renderFileBrowser.then((fileBrowserEl) => {
				const btnOpenFileBrowser = fileBrowserEl.getElementsByClassName('open-file-browser').item(0);
				btnOpenFileBrowser.click();
				return fileBrowserEl;
			});
		}
		return renderFileBrowser
	},

	/** @private */
	truncatePath(path) {
		if (path.length > 50)
			path = `${path.substring(0, 25)}…${path.substring(path.length - 25)}`;

		return path;
	},

	/** @private */
	iconForType(type) {
		switch (type) {
		case 'symlink':
			return E('img', {
				'src': L.resource('cbi/link.svg'),
				'width': 16,
				'title': _('Symbolic link'),
				'class': 'middle'
			});

		case 'directory':
			return E('img', {
				'src': L.resource('cbi/folder.svg'),
				'width': 16,
				'title': _('Directory'),
				'class': 'middle'
			});

		default:
			return E('img', {
				'src': L.resource('cbi/file.svg'),
				'width': 16,
				'title': _('File'),
				'class': 'middle'
			});
		}
	},

	/** @private */
	canonicalizePath(path) {
	return path.replace(/\/{2,}/g, '/')                // Collapse multiple slashes
				.replace(/\/\.(\/|$)/g, '/')           // Remove `/.`
				.replace(/[^\/]+\/\.\.(\/|$)/g, '/')   // Resolve `/..`
				.replace(/\/$/g, (m, o, s) => s.length > 1 ? '' : '/'); // Remove trailing `/` only if not root
	},

	/** @private */
	splitPath(path) {
		const croot = this.canonicalizePath(this.options.root_directory ?? '/');
		const cpath = this.canonicalizePath(path ?? '/');

		if (cpath.length <= croot.length)
			return [ croot ];

		const parts = cpath.substring(croot.length).split(/\//);

		parts.unshift(croot);

		return parts;
	},

	/** @private */
	handleUpload(path, list, ev) {
		const form = ev.target.parentNode;
		const fileinput = form.querySelector('input[type="file"]');
		const nameinput = form.querySelector('input[type="text"]');
		const filename = (nameinput.value != null ? nameinput.value : '').trim();

		ev.preventDefault();

		if (filename == '' || filename.match(/\//) || fileinput.files[0] == null)
			return;

		const existing = list.filter(e => e.name == filename)[0];

		if (existing != null && existing.type == 'directory')
			return alert(_('A directory with the same name already exists.'));
		else if (existing != null && !confirm(_('Overwrite existing file "%s" ?').format(filename)))
			return;

		const data = new FormData();

		data.append('sessionid', L.env.sessionid);
		data.append('filename', `${path}/${filename}`);
		data.append('filedata', fileinput.files[0]);

		return request.post(`${L.env.cgi_base}/cgi-upload`, data, {
			progress: L.bind((btn, ev) => {
				btn.firstChild.data = '%.2f%%'.format((ev.loaded / ev.total) * 100);
			}, this, ev.target)
		}).then(L.bind((path, ev, res) => {
			const reply = res.json();

			if (L.isObject(reply) && reply.failure)
				alert(_('Upload request failed: %s').format(reply.message));

			return this.handleSelect(path, null, ev);
		}, this, path, ev));
	},

	/** @private */
	handleDelete(path, fileStat, ev) {
		const parent = path.replace(/\/[^\/]+$/, '') ?? '/';
		const name = path.replace(/^.+\//, '');
		let msg;

		ev.preventDefault();

		if (fileStat.type == 'directory')
			msg = _('Do you really want to delete the "%s" directory recursively?').format(name);
		else
			msg = _('Do you really want to delete "%s" ?').format(name);

		if (confirm(msg)) {
			const button = this.node.firstElementChild;
			const hidden = this.node.lastElementChild;

			if (path == hidden.value) {
				dom.content(button, _('Select file…'));
				hidden.value = '';
			}

			return fs.remove(path).then(L.bind((parent, ev) => {
				return this.handleSelect(parent, null, ev);
			}, this, parent, ev)).catch(err => {
				alert(_('Delete request failed: %s').format(err.message));
			});
		}
	},

	/** @private */
	renderUpload(path, list) {
		if (!this.options.enable_upload)
			return E([]);

		return E([
			E('a', {
				'href': '#',
				'class': 'btn cbi-button-positive',
				'click': function(ev) {
					const uploadForm = ev.target.nextElementSibling;
					const fileInput = uploadForm.querySelector('input[type="file"]');

					ev.target.style.display = 'none';
					uploadForm.style.display = '';
					fileInput.click();
				}
			}, _('Upload file…')),
			E('div', { 'class': 'upload', 'style': 'display:none' }, [
				E('input', {
					'type': 'file',
					'style': 'display:none',
					'change': function(ev) {
						const nameinput = ev.target.parentNode.querySelector('input[type="text"]');
						const uploadbtn = ev.target.parentNode.querySelector('button.cbi-button-save');

						nameinput.value = ev.target.value.replace(/^.+[\/\\]/, '');
						uploadbtn.disabled = false;
					}
				}),
				E('button', {
					'class': 'btn',
					'click': function(ev) {
						ev.preventDefault();
						ev.target.previousElementSibling.click();
					}
				}, [ _('Browse…') ]),
				E('div', {}, E('input', { 'type': 'text', 'placeholder': _('Filename') })),
				E('button', {
					'class': 'btn cbi-button-save',
					'click': UI.prototype.createHandlerFn(this, 'handleUpload', path, list),
					'disabled': true
				}, [ _('Upload file') ])
			])
		]);
	},

	/** @private */
	renderListing(container, path, list) {
		const breadcrumb = E('p');
		const rows = E('ul');

		list.sort((a, b) => {
			return L.naturalCompare(a.type == 'directory', b.type == 'directory') ||
				   L.naturalCompare(a.name, b.name);
		});

		for (let i = 0; i < list.length; i++) {
			if (!this.options.show_hidden && list[i].name.charAt(0) == '.')
				continue;

			const entrypath = this.canonicalizePath(`${path}/${list[i].name}`);
			const selected = (entrypath == this.node.lastElementChild.value);
			const mtime = new Date(list[i].mtime * 1000);

			rows.appendChild(E('li', [
				E('div', { 'class': 'name' }, [
					this.iconForType(list[i].type),
					' ',
					E('a', {
						'href': '#',
						'style': selected ? 'font-weight:bold' : null,
						'click': UI.prototype.createHandlerFn(this, 'handleSelect',
							entrypath, list[i].type != 'directory' ? list[i] : null)
					}, '%h'.format(list[i].name))
				]),
				E('div', { 'class': 'mtime hide-xs' }, [
					' %04d-%02d-%02d %02d:%02d:%02d '.format(
						mtime.getFullYear(),
						mtime.getMonth() + 1,
						mtime.getDate(),
						mtime.getHours(),
						mtime.getMinutes(),
						mtime.getSeconds())
				]),
				E('div', [
					selected ? E('button', {
						'class': 'btn',
						'click': UI.prototype.createHandlerFn(this, 'handleReset')
					}, [ _('Deselect') ]) : '',
					this.options.enable_download && list[i].type == 'file' ? E('button', {
						'class': 'btn',
						'click': UI.prototype.createHandlerFn(this, 'handleDownload', entrypath, list[i])
					}, [ _('Download') ]) : '',
					this.options.enable_remove ? E('button', {
						'class': 'btn cbi-button-negative',
						'click': UI.prototype.createHandlerFn(this, 'handleDelete', entrypath, list[i])
					}, [ _('Delete') ]) : ''
				])
			]));
		}

		if (!rows.firstElementChild)
			rows.appendChild(E('em', _('No entries in this directory')));

		const dirs = this.splitPath(path);
		let cur = '';

		for (let i = 0; i < dirs.length; i++) {
			cur += dirs[i];
			dom.append(breadcrumb, [
				i ? ' » ' : '',
				E('a', {
					'href': '#',
					'click': UI.prototype.createHandlerFn(this, 'handleSelect', cur ?? '/', null)
				}, dirs[i] !== '/' ? '%h'.format(dirs[i]) : E('em', '(root)')),
			]);
		}

		dom.content(container, [
			breadcrumb,
			rows,
			E('div', { 'class': 'right' }, [
				this.renderUpload(path, list),
				!this.options.browser ? E('a', {
					'href': '#',
					'class': 'btn',
					'click': UI.prototype.createHandlerFn(this, 'handleCancel')
				}, _('Cancel')) : ''
			]),
		]);
	},

	/** @private */
	handleCancel(ev) {
		const button = this.node.firstElementChild;
		const browser = button.nextElementSibling;

		browser.classList.remove('open');
		button.style.display = '';

		this.node.dispatchEvent(new CustomEvent('cbi-fileupload-cancel', {}));

		ev.preventDefault();
	},

	/** @private */
	handleReset(ev) {
		const button = this.node.firstElementChild;
		const hidden = this.node.lastElementChild;

		hidden.value = '';
		dom.content(button, _('Select file…'));

		this.handleCancel(ev);
	},

	/** @private */
	handleDownload(path, fileStat, ev) {
		fs.read_direct(path, 'blob').then((blob) => {
			const url = window.URL.createObjectURL(blob);
			let a = document.createElement('a');
			a.style.display = 'none';
			a.href = url;
			a.download = fileStat.name;
			document.body.appendChild(a);
			a.click();
			window.URL.revokeObjectURL(url);
		}).catch((err) => {
			alert(_('Download failed: %s').format(err.message));
		});
	},

	/** @private */
	handleSelect(path, fileStat, ev) {
		const browser = dom.parent(ev.target, '.cbi-filebrowser');
		const ul = browser.querySelector('ul');

		if (fileStat == null) {
			dom.content(ul, E('em', { 'class': 'spinning' }, _('Loading directory contents…')));
			L.resolveDefault(fs.list(path), []).then(L.bind(this.renderListing, this, browser, path));
		}
		else if (!this.options.browser) {
			const button = this.node.firstElementChild;
			const hidden = this.node.lastElementChild;

			path = this.canonicalizePath(path);

			dom.content(button, [
				this.iconForType(fileStat.type),
				' %s (%1000mB)'.format(this.truncatePath(path), fileStat.size)
			]);

			browser.classList.remove('open');
			button.style.display = '';
			hidden.value = path;

			this.stat = Object.assign({ path: path }, fileStat);
			this.node.dispatchEvent(new CustomEvent('cbi-fileupload-select', { detail: this.stat }));
		}
	},

	/** @private */
	handleFileBrowser(ev) {
		const button = ev.target;
		const browser = button.nextElementSibling;
		let path = this.stat ? this.stat.path.replace(/\/[^\/]+$/, '') : (this.options.initial_directory ?? this.options.root_directory);

		if (path.indexOf(this.options.root_directory) != 0)
			path = this.options.root_directory;

		ev.preventDefault();

		return L.resolveDefault(fs.list(path), []).then(L.bind((button, browser, path, list) => {
			document.querySelectorAll('.cbi-filebrowser.open').forEach(browserEl => {
				dom.findClassInstance(browserEl).handleCancel(ev);
			});

			button.style.display = 'none';
			browser.classList.add('open');

			return this.renderListing(browser, path, list);
		}, this, button, browser, path));
	},

	/** @override */
	getValue() {
		return this.node.lastElementChild.value;
	},

	/** @override */
	setValue(value) {
		this.node.lastElementChild.value = value;
	}
});


function scrubMenu(node) {
	let hasSatisfiedChild = false;

	if (L.isObject(node.children)) {
		for (const k in node.children) {
			const child = scrubMenu(node.children[k]);

			if (child.title && !child.firstchild_ineligible)
				hasSatisfiedChild ||= child.satisfied;
		}
	}

	if (L.isObject(node.action) &&
		node.action.type == 'firstchild' &&
		hasSatisfiedChild == false)
		node.satisfied = false;

	return node;
}

/**
 * Handle menu.
 *
 * @constructor menu
 * @memberof LuCI.ui
 *
 * @classdesc
 *
 * Handles menus.
 */
const UIMenu = baseclass.singleton(/** @lends LuCI.ui.menu.prototype */ {
	/**
	 * @typedef {Object} MenuNode
	 * @memberof LuCI.ui.menu

	 * @property {string} name - The internal name of the node, as used in the URL
	 * @property {number} order - The sort index of the menu node
	 * @property {string} [title] - The title of the menu node, `null` if the node should be hidden
	 * @property {satisfied} boolean - Boolean indicating whether the menu entries dependencies are satisfied
	 * @property {readonly} [boolean] - Boolean indicating whether the menu entries underlying ACLs are readonly
	 * @property {LuCI.ui.menu.MenuNode[]} [children] - Array of child menu nodes.
	 */

	/**
	 * Load and cache current menu tree.
	 *
	 * @returns {Promise<LuCI.ui.menu.MenuNode>}
	 * Returns a promise resolving to the root element of the menu tree.
	 */
	load() {
		if (this.menu == null)
			this.menu = session.getLocalData('menu');

		if (!L.isObject(this.menu)) {
			this.menu = request.get(L.url('admin/menu')).then(L.bind((menu) => {
				this.menu = scrubMenu(menu.json());
				session.setLocalData('menu', this.menu);

				return this.menu;
			}, this));
		}

		return Promise.resolve(this.menu);
	},

	/**
	 * Flush the internal menu cache to force loading a new structure on the
	 * next page load.
	 */
	flushCache() {
		session.setLocalData('menu', null);
	},

	/**
	 * @param {LuCI.ui.menu.MenuNode} [node]
	 * The menu node to retrieve the children for. Defaults to the menu's
	 * internal root node if omitted.
	 *
	 * @returns {LuCI.ui.menu.MenuNode[]}
	 * Returns an array of child menu nodes.
	 */
	getChildren(node) {
		const children = [];

		if (node == null)
			node = this.menu;

		for (const k in node.children) {
			if (!node.children.hasOwnProperty(k))
				continue;

			if (!node.children[k].satisfied)
				continue;

			if (!node.children[k].hasOwnProperty('title'))
				continue;

			let subnode = Object.assign(node.children[k], { name: k });

			if (L.isObject(subnode.action) && subnode.action.path != null &&
				(subnode.action.type == 'alias' || subnode.action.type == 'rewrite')) {
				let root = this.menu;
				const path = subnode.action.path.split('/');

				for (let i = 0; root != null && i < path.length; i++)
					root = L.isObject(root.children) ? root.children[path[i]] : null;

				if (root)
					subnode = Object.assign({}, subnode, {
						children: root.children,
						action: root.action
					});
			}

			children.push(subnode);
		}

		return children.sort((a, b) => {
			const wA = a.order ?? 1000;
			const wB = b.order ?? 1000;

			if (wA != wB)
				return wA - wB;

			return L.naturalCompare(a.name, b.name);
		});
	}
});

const UITable = baseclass.extend(/** @lends LuCI.ui.table.prototype */ {
	__init__(captions, options, placeholder) {
		if (!Array.isArray(captions)) {
			this.initFromMarkup(captions);

			return;
		}

		const id = options.id ?? 'table%08x'.format(Math.random() * 0xffffffff);

		const table = E('table', { 'id': id, 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles', 'click': UI.prototype.createHandlerFn(this, 'handleSort') })
		]);

		this.id = id;
		this.node = table
		this.options = options;

		const sorting = this.getActiveSortState();

		for (let i = 0; i < captions.length; i++) {
			if (captions[i] == null)
				continue;

			const th = E('th', { 'class': 'th' }, [ captions[i] ]);

			if (typeof(options.captionClasses) == 'object')
				DOMTokenList.prototype.add.apply(th.classList, L.toArray(options.captionClasses[i]));

			if (options.sortable !== false && (typeof(options.sortable) != 'object' || options.sortable[i] !== false)) {
				th.setAttribute('data-sortable-row', true);

				if (sorting && sorting[0] == i)
					th.setAttribute('data-sort-direction', sorting[1] ? 'desc' : 'asc');
			}

			table.firstElementChild.appendChild(th);
		}

		if (placeholder) {
			const trow = table.appendChild(E('tr', { 'class': 'tr placeholder' }));
			const td = trow.appendChild(E('td', { 'class': 'td' }, placeholder));

			if (typeof(captionClasses) == 'object')
				DOMTokenList.prototype.add.apply(td.classList, L.toArray(captionClasses[0]));
		}

		DOMTokenList.prototype.add.apply(table.classList, L.toArray(options.classes));
	},

	update(data, placeholderText) {
		const placeholder = placeholderText ?? this.options.placeholder ?? _('No data', 'empty table placeholder');
		const sorting = this.getActiveSortState();

		if (!Array.isArray(data))
			return;

		const headings = [].slice.call(this.node.firstElementChild.querySelectorAll('th, .th'));

		if (sorting) {
			const list = data.map(L.bind((row) => {
				return [ this.deriveSortKey(row[sorting[0]], sorting[0]), row ];
			}, this));

			list.sort((a, b) => {
				return sorting[1]
					? -L.naturalCompare(a[0], b[0])
					: L.naturalCompare(a[0], b[0]);
			});

			data.length = 0;

			list.forEach(item => {
				data.push(item[1]);
			});

			headings.forEach((th, i) => {
				if (i == sorting[0])
					th.setAttribute('data-sort-direction', sorting[1] ? 'desc' : 'asc');
				else
					th.removeAttribute('data-sort-direction');
			});
		}

		this.data = data;
		this.placeholder = placeholder;

		let n = 0;
		const rows = this.node.querySelectorAll('tr, .tr');
		const trows = [];
		const captionClasses = this.options.captionClasses;
		const trTag = (rows[0] && rows[0].nodeName == 'DIV') ? 'div' : 'tr';
		const tdTag = (headings[0] && headings[0].nodeName == 'DIV') ? 'div' : 'td';

		data.forEach(row => {
			trows[n] = E(trTag, { 'class': 'tr' });

			for (let i = 0; i < headings.length; i++) {
				const text = (headings[i].innerText ?? '').trim();
				const raw_val = Array.isArray(row[i]) ? row[i][0] : null;
				const disp_val = Array.isArray(row[i]) ? row[i][1] : row[i];
				const td = trows[n].appendChild(E(tdTag, {
					'class': 'td',
					'data-title': (text !== '') ? text : null,
					'data-value': raw_val
				}, (disp_val != null) ? ((disp_val instanceof DocumentFragment) ? disp_val.cloneNode(true) : disp_val) : ''));

				if (typeof(captionClasses) == 'object')
					DOMTokenList.prototype.add.apply(td.classList, L.toArray(captionClasses[i]));

				if (!td.classList.contains('cbi-section-actions'))
					headings[i].setAttribute('data-sortable-row', true);
			}

			trows[n].classList.add('cbi-rowstyle-%d'.format((n++ % 2) ? 2 : 1));
		});

		for (let i = 0; i < n; i++) {
			if (rows[i+1])
				this.node.replaceChild(trows[i], rows[i+1]);
			else
				this.node.appendChild(trows[i]);
		}

		while (rows[++n])
			this.node.removeChild(rows[n]);

		if (placeholder && this.node.firstElementChild === this.node.lastElementChild) {
			const trow = this.node.appendChild(E(trTag, { 'class': 'tr placeholder' }));
			const td = trow.appendChild(E(tdTag, { 'class': 'td' }, placeholder));

			if (typeof(captionClasses) == 'object')
				DOMTokenList.prototype.add.apply(td.classList, L.toArray(captionClasses[0]));
		}

		return this.node;
	},

	render() {
		return this.node;
	},

	/** @private */
	initFromMarkup(node) {
		if (!dom.elem(node))
			node = document.querySelector(node);

		if (!node)
			throw 'Invalid table selector';

		const options = {};
		const headrow = node.querySelector('tr, .tr');

		if (!headrow)
			return;

		options.id = node.id;
		options.classes = [].slice.call(node.classList).filter(c => c != 'table');
		options.sortable = [];
		options.captionClasses = [];

		headrow.querySelectorAll('th, .th').forEach((th, i) => {
			options.sortable[i] = !th.classList.contains('cbi-section-actions');
			options.captionClasses[i] = [].slice.call(th.classList).filter(c => c != 'th');
		});

		headrow.addEventListener('click', UI.prototype.createHandlerFn(this, 'handleSort'));

		this.id = node.id;
		this.node = node;
		this.options = options;
	},

	/** @private */
	deriveSortKey(value, index) {
		const opts = this.options ?? {};
		let hint;
		let m;

		if (opts.sortable == true || opts.sortable == null)
			hint = 'auto';
		else if (typeof( opts.sortable) == 'object')
			hint =  opts.sortable[index];

		if (dom.elem(value)) {
			if (value.hasAttribute('data-value'))
				value = value.getAttribute('data-value');
			else
				value = (value.innerText ?? '').trim();
		}

		switch (hint ?? 'auto') {
		case true:
		case 'auto':
			m = /^([0-9a-fA-F:.]+)(?:\/([0-9a-fA-F:.]+))?$/.exec(value);

			if (m) {
				let addr;
				let mask;

				addr = validation.parseIPv6(m[1]);
				mask = m[2] ? validation.parseIPv6(m[2]) : null;

				if (addr && mask != null)
					return '%04x%04x%04x%04x%04x%04x%04x%04x%04x%04x%04x%04x%04x%04x%04x%04x'.format(
						addr[0], addr[1], addr[2], addr[3], addr[4], addr[5], addr[6], addr[7],
						mask[0], mask[1], mask[2], mask[3], mask[4], mask[5], mask[6], mask[7]
					);
				else if (addr)
					return '%04x%04x%04x%04x%04x%04x%04x%04x%02x'.format(
						addr[0], addr[1], addr[2], addr[3], addr[4], addr[5], addr[6], addr[7],
						m[2] ? +m[2] : 128
					);

				addr = validation.parseIPv4(m[1]);
				mask = m[2] ? validation.parseIPv4(m[2]) : null;

				if (addr && mask != null)
					return '%03d%03d%03d%03d%03d%03d%03d%03d'.format(
						addr[0], addr[1], addr[2], addr[3],
						mask[0], mask[1], mask[2], mask[3]
					);
				else if (addr)
					return '%03d%03d%03d%03d%02d'.format(
						addr[0], addr[1], addr[2], addr[3],
						m[2] ? +m[2] : 32
					);
			}

			m = /^(?:(\d+)d )?(\d+)h (\d+)m (\d+)s$/.exec(value);

			if (m)
				return '%05d%02d%02d%02d'.format(+m[1], +m[2], +m[3], +m[4]);

			m = /^(\d+)\b(\D*)$/.exec(value);

			if (m)
				return '%010d%s'.format(+m[1], m[2]);

			return String(value);

		case 'ignorecase':
			return String(value).toLowerCase();

		case 'numeric':
			return +value;

		default:
			return String(value);
		}
	},

	/** @private */
	getActiveSortState() {
		if (this.sortState)
			return this.sortState;

		if (!this.options.id)
			return null;

		const page = document.body.getAttribute('data-page');
		const key = `${page}.${this.id}`;
		const state = session.getLocalData('tablesort');

		if (L.isObject(state) && Array.isArray(state[key]))
			return state[key];

		return null;
	},

	/** @private */
	setActiveSortState(index, descending) {
		this.sortState = [ index, descending ];

		if (!this.options.id)
			return;

		const page = document.body.getAttribute('data-page');
		const key = `${page}.${this.options.id}`;
		let state = session.getLocalData('tablesort');

		if (!L.isObject(state))
			state = {};

		state[key] = this.sortState;

		session.setLocalData('tablesort', state);
	},

	/** @private */
	handleSort(ev) {
		if (!ev.target.matches('th[data-sortable-row]'))
			return;

		const th = ev.target;
		const direction = (th.getAttribute('data-sort-direction') == 'asc');
		let index = 0;

		this.node.firstElementChild.querySelectorAll('th').forEach((other_th, i) => {
			if (other_th !== th)
				other_th.removeAttribute('data-sort-direction');
			else
				index = i;
		});

		this.setActiveSortState(index, direction);
		this.update(this.data, this.placeholder);
	}
});

/**
 * @class ui
 * @memberof LuCI
 * @hideconstructor
 * @classdesc
 *
 * Provides high level UI helper functionality.
 * To import the class in views, use `'require ui'`, to import it in
 * external JavaScript, use `L.require("ui").then(...)`.
 */
const UI = baseclass.extend(/** @lends LuCI.ui.prototype */ {
	__init__() {
		modalDiv = document.body.appendChild(
			dom.create('div', {
				id: 'modal_overlay',
				tabindex: -1,
				keydown: this.cancelModal
			}, [
				dom.create('div', {
					class: 'modal',
					role: 'dialog',
					'aria-modal': true
				})
			]));

		tooltipDiv = document.body.appendChild(
			dom.create('div', { class: 'cbi-tooltip' }));

		/* set up old aliases */
		L.showModal = this.showModal;
		L.hideModal = this.hideModal;
		L.showTooltip = this.showTooltip;
		L.hideTooltip = this.hideTooltip;
		L.itemlist = this.itemlist;

		document.addEventListener('mouseover', this.showTooltip.bind(this), true);
		document.addEventListener('mouseout', this.hideTooltip.bind(this), true);
		document.addEventListener('focus', this.showTooltip.bind(this), true);
		document.addEventListener('blur', this.hideTooltip.bind(this), true);

		document.addEventListener('luci-loaded', this.tabs.init.bind(this.tabs));
		document.addEventListener('luci-loaded', this.changes.init.bind(this.changes));
		document.addEventListener('uci-loaded', this.changes.init.bind(this.changes));
	},

	/**
	 * Display a modal overlay dialog with the specified contents.
	 *
	 * The modal overlay dialog covers the current view preventing interaction
	 * with the underlying view contents. Only one modal dialog instance can
	 * be opened. Invoking showModal() while a modal dialog is already open will
	 * replace the open dialog with a new one having the specified contents.
	 *
	 * Additional CSS class names may be passed to influence the appearance of
	 * the dialog. Valid values for the classes depend on the underlying theme.
	 *
	 * @see LuCI.dom.content
	 *
	 * @param {string} [title]
	 * The title of the dialog. If `null`, no title element will be rendered.
	 *
	 * @param {*} children
	 * The contents to add to the modal dialog. This should be a DOM node or
	 * a document fragment in most cases. The value is passed as-is to the
	 * `dom.content()` function - refer to its documentation for applicable
	 * values.
	 *
	 * @param {...string} [classes]
	 * A number of extra CSS class names which are set on the modal dialog
	 * element.
	 *
	 * @returns {Node}
	 * Returns a DOM Node representing the modal dialog element.
	 */
	showModal(title, children, ...classes) {
		const dlg = modalDiv.firstElementChild;

		dlg.setAttribute('class', 'modal');
		dlg.classList.add(...classes);

		dom.content(dlg, dom.create('h4', {}, title));
		dom.append(dlg, children);

		document.body.classList.add('modal-overlay-active');
		modalDiv.scrollTop = 0;
		modalDiv.focus();

		return dlg;
	},

	/**
	 * Close the open modal overlay dialog.
	 *
	 * This function will close an open modal dialog and restore the normal view
	 * behaviour. It has no effect if no modal dialog is currently open.
	 *
	 * Note that this function is stand-alone, it does not rely on `this` and
	 * will not invoke other class functions so it is suitable to be used as event
	 * handler as-is without the need to bind it first.
	 */
	hideModal() {
		document.body.classList.remove('modal-overlay-active');
		modalDiv.blur();
	},

	/** @private */
	cancelModal(ev) {
		if (ev.key == 'Escape') {
			const btn = modalDiv.querySelector('.right > button, .right > .btn, .button-row > .btn');

			if (btn)
				btn.click();
		}
	},

	/** @private */
	showTooltip(ev) {
		const target = findParent(ev.target, '[data-tooltip]');

		if (!target)
			return;

		if (tooltipTimeout !== null) {
			window.clearTimeout(tooltipTimeout);
			tooltipTimeout = null;
		}

		const rect = target.getBoundingClientRect();
		const x = rect.left              + window.pageXOffset;
		let y = rect.top + rect.height + window.pageYOffset;
		let above = false;

		tooltipDiv.className = 'cbi-tooltip';
		tooltipDiv.innerHTML = '▲ ';
		tooltipDiv.firstChild.data += target.getAttribute('data-tooltip');

		if (target.hasAttribute('data-tooltip-style'))
			tooltipDiv.classList.add(target.getAttribute('data-tooltip-style'));

		if ((y + tooltipDiv.offsetHeight) > (window.innerHeight + window.pageYOffset))
			above = true;

		const dropdown = target.querySelector('ul.dropdown[style]:first-child');

		if (dropdown && dropdown.style.top)
			above = true;

		if (above) {
			y -= (tooltipDiv.offsetHeight + target.offsetHeight);
			tooltipDiv.firstChild.data = `▼ ${tooltipDiv.firstChild.data.substr(2)}`;
		}

		tooltipDiv.style.top = `${y}px`;
		tooltipDiv.style.left = `${x}px`;
		tooltipDiv.style.opacity = 1;

		tooltipDiv.dispatchEvent(new CustomEvent('tooltip-open', {
			bubbles: true,
			detail: { target: target }
		}));
	},

	/** @private */
	hideTooltip(ev) {
		if (ev.target === tooltipDiv || ev.relatedTarget === tooltipDiv ||
		    tooltipDiv.contains(ev.target) || tooltipDiv.contains(ev.relatedTarget))
			return;

		if (tooltipTimeout !== null) {
			window.clearTimeout(tooltipTimeout);
			tooltipTimeout = null;
		}

		tooltipDiv.style.opacity = 0;
		tooltipTimeout = window.setTimeout(() => tooltipDiv.removeAttribute('style'), 250);

		tooltipDiv.dispatchEvent(new CustomEvent('tooltip-close', { bubbles: true }));
	},

	/**
	 * Add a notification banner at the top of the current view.
	 *
	 * A notification banner is an alert message usually displayed at the
	 * top of the current view, spanning the entire available width.
	 * Notification banners will stay in place until dismissed by the user.
	 * Multiple banners may be shown at the same time.
	 *
	 * Additional CSS class names may be passed to influence the appearance of
	 * the banner. Valid values for the classes depend on the underlying theme.
	 *
	 * @see LuCI.dom.content
	 *
	 * @param {string} [title]
	 * The title of the notification banner. If `null`, no title element
	 * will be rendered.
	 *
	 * @param {*} children
	 * The contents to add to the notification banner. This should be a DOM
	 * node or a document fragment in most cases. The value is passed as-is
	 * to the `dom.content()` function - refer to its documentation for
	 * applicable values.
	 *	 
	 * @param {...string} [classes]
	 * A number of extra CSS class names which are set on the notification
	 * banner element.
	 *
	 * @returns {Node}
	 * Returns a DOM Node representing the notification banner element.
	 */
	addNotification(title, children, ...classes) {
		const mc = document.querySelector('#maincontent') ?? document.body;
		const msg = E('div', {
			'class': 'alert-message fade-in',
			'style': 'display:flex',
			'transitionend': function(ev) {
				const node = ev.currentTarget;
				if (node.parentNode && node.classList.contains('fade-out'))
					node.parentNode.removeChild(node);
			}
		}, [
			E('div', { 'style': 'flex:10' }),
			E('div', { 'style': 'flex:1 1 auto; display:flex' }, [
				E('button', {
					'class': 'btn',
					'style': 'margin-left:auto; margin-top:auto',
					'click': function(ev) {
						dom.parent(ev.target, '.alert-message').classList.add('fade-out');
					},

				}, [ _('Dismiss') ])
			])
		]);

		if (title != null)
			dom.append(msg.firstElementChild, E('h4', {}, title));

		dom.append(msg.firstElementChild, children);

		msg.classList.add(...classes);

		mc.insertBefore(msg, mc.firstElementChild);

		return msg;
	},

	/**
	 * Add a time-limited notification banner at the top of the current view.
	 *
	 * A notification banner is an alert message usually displayed at the
	 * top of the current view, spanning the entire available width.
	 * Notification banners will stay in place until dismissed by the user, or
	 * it has expired.
	 * Multiple banners may be shown at the same time.
	 *
	 * Additional CSS class names may be passed to influence the appearance of
	 * the banner. Valid values for the classes depend on the underlying theme.
	 *
	 * @see LuCI.dom.content
	 *
	 * @param {string} [title]
	 * The title of the notification banner. If `null`, no title element
	 * will be rendered.
	 *
	 * @param {*} children
	 * The contents to add to the notification banner. This should be a DOM
	 * node or a document fragment in most cases. The value is passed as-is
	 * to the `dom.content()` function - refer to its documentation for
	 * applicable values.
	 * 
	 * @param {int} [timeout]
	 * A millisecond value after which the notification will disappear
	 * automatically. If omitted, the notification will remain until it receives
	 * the click event.
	 *
	 * @param {...string} [classes]
	 * A number of extra CSS class names which are set on the notification
	 * banner element.
	 *
	 * @returns {Node}
	 * Returns a DOM Node representing the notification banner element.
	 */
	addTimeLimitedNotification(title, children, timeout, ...classes) {
		const msg = this.addNotification(title, children, ...classes);

		function fadeOutNotification(element) {
			if (element) {
				element.classList.add('fade-out');
				element.classList.remove('fade-in');
				setTimeout(() => {
					if (element.parentNode) {
						element.parentNode.removeChild(element);
					}
				});
			}
		}

		if (typeof timeout === 'number' && timeout > 0) {
			setTimeout(() => fadeOutNotification(msg), timeout);
		}

		return msg;
	},

	/**
	 * Display or update a header area indicator.
	 *
	 * An indicator is a small label displayed in the header area of the screen
	 * providing few amounts of status information such as item counts or state
	 * toggle indicators.
	 *
	 * Multiple indicators may be shown at the same time and indicator labels
	 * may be made clickable to display extended information or to initiate
	 * further actions.
	 *
	 * Indicators can either use a default `active` or a less accented `inactive`
	 * style which is useful for indicators representing state toggles.
	 *
	 * @param {string} id
	 * The ID of the indicator. If an indicator with the given ID already exists,
	 * it is updated with the given label and style.
	 *
	 * @param {string} label
	 * The text to display in the indicator label.
	 *
	 * @param {function} [handler]
	 * A handler function to invoke when the indicator label is clicked/touched
	 * by the user. If omitted, the indicator is not clickable/touchable.
	 *
	 * Note that this parameter only applies to new indicators, when updating
	 * existing labels it is ignored.
	 *
	 * @param {"active"|"inactive"} [style=active]
	 * The indicator style to use. May be either `active` or `inactive`.
	 *
	 * @returns {boolean}
	 * Returns `true` when the indicator has been updated or `false` when no
	 * changes were made.
	 */
	showIndicator(id, label, handler, style) {
		if (indicatorDiv == null) {
			indicatorDiv = document.body.querySelector('#indicators');

			if (indicatorDiv == null)
				return false;
		}

		const handlerFn = (typeof(handler) == 'function') ? handler : null;
		let indicatorElem = indicatorDiv.querySelector('span[data-indicator="%s"]'.format(id));

		if (indicatorElem == null) {
			let beforeElem = null;

			for (beforeElem = indicatorDiv.firstElementChild;
			     beforeElem != null;
			     beforeElem = beforeElem.nextElementSibling)
				if (beforeElem.getAttribute('data-indicator') > id)
					break;

			indicatorElem = indicatorDiv.insertBefore(E('span', {
				'data-indicator': id,
				'data-clickable': handlerFn ? true : null,
				'click': handlerFn
			}, ['']), beforeElem);
		}

		if (label == indicatorElem.firstChild.data && style == indicatorElem.getAttribute('data-style'))
			return false;

		indicatorElem.firstChild.data = label;
		indicatorElem.setAttribute('data-style', (style == 'inactive') ? 'inactive' : 'active');
		return true;
	},

	/**
	 * Remove a header area indicator.
	 *
	 * This function removes the given indicator label from the header indicator
	 * area. When the given indicator is not found, this function does nothing.
	 *
	 * @param {string} id
	 * The ID of the indicator to remove.
	 *
	 * @returns {boolean}
	 * Returns `true` when the indicator has been removed or `false` when the
	 * requested indicator was not found.
	 */
	hideIndicator(id) {
		const indicatorElem = indicatorDiv ? indicatorDiv.querySelector('span[data-indicator="%s"]'.format(id)) : null;

		if (indicatorElem == null)
			return false;

		indicatorDiv.removeChild(indicatorElem);
		return true;
	},

	/**
	 * Formats a series of label/value pairs into list-like markup.
	 *
	 * This function transforms a flat array of alternating label and value
	 * elements into a list-like markup, using the values in `separators` as
	 * separators and appends the resulting nodes to the given parent DOM node.
	 *
	 * Each label is suffixed with `: ` and wrapped into a `<strong>` tag, the
	 * `<strong>` element and the value corresponding to the label are
	 * subsequently wrapped into a `<span class="nowrap">` element.
	 *
	 * The resulting `<span>` element tuples are joined by the given separators
	 * to form the final markup which is appended to the given parent DOM node.
	 *
	 * @param {Node} node
	 * The parent DOM node to append the markup to. Any previous child elements
	 * will be removed.
	 *
	 * @param {Array<*>} items
	 * An alternating array of labels and values. The label values will be
	 * converted to plain strings, the values are used as-is and may be of
	 * any type accepted by `LuCI.dom.content()`.
	 *
	 * @param {*|Array<*>} [separators=[E('br')]]
	 * A single value or an array of separator values to separate each
	 * label/value pair with. The function will cycle through the separators
	 * when joining the pairs. If omitted, the default separator is a sole HTML
	 * `<br>` element. Separator values are used as-is and may be of any type
	 * accepted by `LuCI.dom.content()`.
	 *
	 * @returns {Node}
	 * Returns the parent DOM node the formatted markup has been added to.
	 */
	itemlist(node, items, separators) {
		const children = [];

		if (!Array.isArray(separators))
			separators = [ separators ?? E('br') ];

		for (let i = 0; i < items.length; i += 2) {
			if (items[i+1] !== null && items[i+1] !== undefined) {
				const sep = separators[(i/2) % separators.length];
				const cld = [];

				children.push(E('span', { class: 'nowrap' }, [
					items[i] ? E('strong', `${items[i]}: `) : '',
					items[i+1]
				]));

				if ((i+2) < items.length)
					children.push(dom.elem(sep) ? sep.cloneNode(true) : sep);
			}
		}

		dom.content(node, children);

		return node;
	},

	/**
	 * @class
	 * @memberof LuCI.ui
	 * @hideconstructor
	 * @classdesc
	 *
	 * The `tabs` class handles tab menu groups used throughout the view area.
	 * It takes care of setting up tab groups, tracking their state and handling
	 * related events.
	 *
	 * This class is automatically instantiated as part of `LuCI.ui`. To use it
	 * in views, use `'require ui'` and refer to `ui.tabs`. To import it in
	 * external JavaScript, use `L.require("ui").then(...)` and access the
	 * `tabs` property of the class instance value.
	 */
	tabs: baseclass.singleton(/* @lends LuCI.ui.tabs.prototype */ {
		/** @private */
		init() {
			const groups = [];
			let prevGroup = null;
			let currGroup = null;

			document.querySelectorAll('[data-tab]').forEach(tab => {
				const parent = tab.parentNode;

				if (dom.matches(tab, 'li') && dom.matches(parent, 'ul.cbi-tabmenu'))
					return;

				if (!parent.hasAttribute('data-tab-group'))
					parent.setAttribute('data-tab-group', groups.length);

				currGroup = +parent.getAttribute('data-tab-group');

				if (currGroup !== prevGroup) {
					prevGroup = currGroup;

					if (!groups[currGroup])
						groups[currGroup] = [];
				}

				groups[currGroup].push(tab);
			});

			for (let i = 0; i < groups.length; i++)
				this.initTabGroup(groups[i]);

			document.addEventListener('dependency-update', this.updateTabs.bind(this));

			this.updateTabs();
		},

		/**
		 * Initializes a new tab group from the given tab pane collection.
		 *
		 * This function cycles through the given tab pane DOM nodes, extracts
		 * their tab IDs, titles and active states, renders a corresponding
		 * tab menu and prepends it to the tab panes common parent DOM node.
		 *
		 * The tab menu labels will be set to the value of the `data-tab-title`
		 * attribute of each corresponding pane. The last pane with the
		 * `data-tab-active` attribute set to `true` will be selected by default.
		 *
		 * If no pane is marked as active, the first one will be preselected.
		 *
		 * @instance
		 * @memberof LuCI.ui.tabs
		 * @param {Array<Node>|NodeList} panes
		 * A collection of tab panes to build a tab group menu for. May be a
		 * plain array of DOM nodes or a NodeList collection, such as the result
		 * of a `querySelectorAll()` call or the `.childNodes` property of a
		 * DOM node.
		 */
		initTabGroup(panes) {
			if (typeof(panes) != 'object' || !('length' in panes) || panes.length === 0)
				return;

			const menu = E('ul', { 'class': 'cbi-tabmenu' });
			const group = panes[0].parentNode;
			const groupId = +group.getAttribute('data-tab-group');
			let selected = null;

			if (group.getAttribute('data-initialized') === 'true')
				return;

			for (let i = 0, pane; pane = panes[i]; i++) {
				const name = pane.getAttribute('data-tab');
				const title = pane.getAttribute('data-tab-title');
				const active = pane.getAttribute('data-tab-active') === 'true';

				menu.appendChild(E('li', {
					'style': this.isEmptyPane(pane) ? 'display:none' : null,
					'class': active ? 'cbi-tab' : 'cbi-tab-disabled',
					'data-tab': name
				}, E('a', {
					'href': '#',
					'click': this.switchTab.bind(this)
				}, title)));

				if (active)
					selected = i;
			}

			group.parentNode.insertBefore(menu, group);
			group.setAttribute('data-initialized', true);

			if (selected === null) {
				selected = this.getActiveTabId(panes[0]);

				if (selected < 0 || selected >= panes.length || this.isEmptyPane(panes[selected])) {
					for (let i = 0; i < panes.length; i++) {
						if (!this.isEmptyPane(panes[i])) {
							selected = i;
							break;
						}
					}
				}

				menu.childNodes[selected].classList.add('cbi-tab');
				menu.childNodes[selected].classList.remove('cbi-tab-disabled');
				panes[selected].setAttribute('data-tab-active', 'true');

				this.setActiveTabId(panes[selected], selected);
			}

			requestAnimationFrame(L.bind(pane => {
				pane.dispatchEvent(new CustomEvent('cbi-tab-active', {
					detail: { tab: pane.getAttribute('data-tab') }
				}));
			}, this, panes[selected]));

			this.updateTabs(group);
		},

		/**
		 * Checks whether the given tab pane node is empty.
		 *
		 * @instance
		 * @memberof LuCI.ui.tabs
		 * @param {Node} pane
		 * The tab pane to check.
		 *
		 * @returns {boolean}
		 * Returns `true` if the pane is empty, else `false`.
		 */
		isEmptyPane(pane) {
			return dom.isEmpty(pane, n => n.classList.contains('cbi-tab-descr'));
		},

		/** @private */
		getPathForPane(pane) {
			const path = [];
			let node = null;

			for (node = pane ? pane.parentNode : null;
			     node != null && node.hasAttribute != null;
			     node = node.parentNode)
			{
				if (node.hasAttribute('data-tab'))
					path.unshift(node.getAttribute('data-tab'));
				else if (node.hasAttribute('data-section-id'))
					path.unshift(node.getAttribute('data-section-id'));
			}

			return path.join('/');
		},

		/** @private */
		getActiveTabState() {
			const page = document.body.getAttribute('data-page');
			const state = session.getLocalData('tab');

			if (L.isObject(state) && state.page === page && L.isObject(state.paths))
				return state;

			session.setLocalData('tab', null);

			return { page: page, paths: {} };
		},

		/** @private */
		getActiveTabId(pane) {
			const path = this.getPathForPane(pane);
			return +this.getActiveTabState().paths[path] ?? 0;
		},

		/** @private */
		setActiveTabId(pane, tabIndex) {
			const path = this.getPathForPane(pane);
			const state = this.getActiveTabState();

			state.paths[path] = tabIndex;

			return session.setLocalData('tab', state);
		},

		/** @private */
		updateTabs(ev, root) {
			(root ?? document).querySelectorAll('[data-tab-title]').forEach(L.bind((pane) => {
				const menu = pane.parentNode.previousElementSibling;
				const tab = menu ? menu.querySelector('[data-tab="%s"]'.format(pane.getAttribute('data-tab'))) : null;
				const n_errors = pane.querySelectorAll('.cbi-input-invalid').length;

				if (!menu || !tab)
					return;

				if (this.isEmptyPane(pane)) {
					tab.style.display = 'none';
					tab.classList.remove('flash');
				}
				else if (tab.style.display === 'none') {
					tab.style.display = '';
					requestAnimationFrame(() => tab.classList.add('flash'));
				}

				if (n_errors) {
					tab.setAttribute('data-errors', n_errors);
					tab.setAttribute('data-tooltip', _('%d invalid field(s)').format(n_errors));
					tab.setAttribute('data-tooltip-style', 'error');
				}
				else {
					tab.removeAttribute('data-errors');
					tab.removeAttribute('data-tooltip');
				}
			}, this));
		},

		/** @private */
		switchTab(ev) {
			const tab = ev.target.parentNode;
			const name = tab.getAttribute('data-tab');
			const menu = tab.parentNode;
			const group = menu.nextElementSibling;
			const groupId = +group.getAttribute('data-tab-group');
			let index = 0;

			ev.preventDefault();

			if (!tab.classList.contains('cbi-tab-disabled'))
				return;

			menu.querySelectorAll('[data-tab]').forEach(tab => {
				tab.classList.remove('cbi-tab');
				tab.classList.remove('cbi-tab-disabled');
				tab.classList.add(
					tab.getAttribute('data-tab') === name ? 'cbi-tab' : 'cbi-tab-disabled');
			});

			group.childNodes.forEach(pane => {
				if (dom.matches(pane, '[data-tab]')) {
					if (pane.getAttribute('data-tab') === name) {
						pane.setAttribute('data-tab-active', 'true');
						pane.dispatchEvent(new CustomEvent('cbi-tab-active', { detail: { tab: name } }));
						UI.prototype.tabs.setActiveTabId(pane, index);
					}
					else {
						pane.setAttribute('data-tab-active', 'false');
					}

					index++;
				}
			});
		}
	}),

	/**
	 * @typedef {Object} FileUploadReply
	 * @memberof LuCI.ui

	 * @property {string} name - Name of the uploaded file without directory components
	 * @property {number} size - Size of the uploaded file in bytes
	 * @property {string} checksum - The MD5 checksum of the received file data
	 * @property {string} sha256sum - The SHA256 checksum of the received file data
	 */

	/**
	 * Display a modal file upload prompt.
	 *
	 * This function opens a modal dialog prompting the user to select and
	 * upload a file to a predefined remote destination path.
	 *
	 * @param {string} path
	 * The remote file path to upload the local file to.
	 *
	 * @param {Node} [progressStatusNode]
	 * An optional DOM text node whose content text is set to the progress
	 * percentage value during file upload.
	 *
	 * @returns {Promise<LuCI.ui.FileUploadReply>}
	 * Returns a promise resolving to a file upload status object on success
	 * or rejecting with an error in case the upload failed or has been
	 * cancelled by the user.
	 */
	uploadFile(path, progressStatusNode) {
		return new Promise((resolveFn, rejectFn) => {
			UI.prototype.showModal(_('Uploading file…'), [
				E('p', _('Please select the file to upload.')),
				E('div', { 'style': 'display:flex' }, [
					E('div', { 'class': 'left', 'style': 'flex:1' }, [
						E('input', {
							type: 'file',
							style: 'display:none',
							change(ev) {
								const modal = dom.parent(ev.target, '.modal');
								const body = modal.querySelector('p');
								const upload = modal.querySelector('.cbi-button-action.important');
								const file = ev.currentTarget.files[0];

								if (file == null)
									return;

								dom.content(body, [
									E('ul', {}, [
										E('li', {}, [ '%s: %s'.format(_('Name'), file.name.replace(/^.*[\\\/]/, '')) ]),
										E('li', {}, [ '%s: %1024mB'.format(_('Size'), file.size) ])
									])
								]);

								upload.disabled = false;
								upload.focus();
							}
						}),
						E('button', {
							'class': 'btn cbi-button',
							'click': function(ev) {
								ev.target.previousElementSibling.click();
							}
						}, [ _('Browse…') ])
					]),
					E('div', { 'class': 'right', 'style': 'flex:1' }, [
						E('button', {
							'class': 'btn',
							'click': function() {
								UI.prototype.hideModal();
								rejectFn(new Error(_('Upload has been cancelled')));
							}
						}, [ _('Cancel') ]),
						' ',
						E('button', {
							'class': 'btn cbi-button-action important',
							'disabled': true,
							'click': function(ev) {
								const input = dom.parent(ev.target, '.modal').querySelector('input[type="file"]');

								if (!input.files[0])
									return;

								const progress = E('div', { 'class': 'cbi-progressbar', 'title': '0%' }, E('div', { 'style': 'width:0' }));

								UI.prototype.showModal(_('Uploading file…'), [ progress ]);

								const data = new FormData();

								data.append('sessionid', rpc.getSessionID());
								data.append('filename', path);
								data.append('filedata', input.files[0]);

								const filename = input.files[0].name;

								request.post(`${L.env.cgi_base}/cgi-upload`, data, {
									timeout: 0,
									progress(pev) {
										const percent = (pev.loaded / pev.total) * 100;

										if (progressStatusNode)
											progressStatusNode.data = '%.2f%%'.format(percent);

										progress.setAttribute('title', '%.2f%%'.format(percent));
										progress.firstElementChild.style.width = '%.2f%%'.format(percent);
									}
								}).then(res => {
									const reply = res.json();

									UI.prototype.hideModal();

									if (L.isObject(reply) && reply.failure) {
										UI.prototype.addNotification(null, E('p', _('Upload request failed: %s').format(reply.message)));
										rejectFn(new Error(reply.failure));
									}
									else {
										reply.name = filename;
										resolveFn(reply);
									}
								}, err => {
									UI.prototype.hideModal();
									rejectFn(err);
								});
							}
						}, [ _('Upload') ])
					])
				])
			]);
		});
	},

	/**
	 * Perform a device connectivity test.
	 *
	 * Attempt to fetch a well known resource from the remote device via HTTP
	 * in order to test connectivity. This function is mainly useful to wait
	 * for the router to come back online after a reboot or reconfiguration.
	 *
	 * @param {string} [proto=http]
	 * The protocol to use for fetching the resource. May be either `http`
	 * (the default) or `https`.
	 *
	 * @param {string} [ipaddr=window.location.host]
	 * Override the host address to probe. By default the current host as seen
	 * in the address bar is probed.
	 *
	 * @returns {Promise<Event>}
	 * Returns a promise resolving to a `load` event in case the device is
	 * reachable or rejecting with an `error` event in case it is not reachable
	 * or rejecting with `null` when the connectivity check timed out.
	 */
	pingDevice(proto, ipaddr) {
		const target = '%s://%s%s?%s'.format(proto ?? 'http', ipaddr ?? window.location.host, L.resource('icons/loading.svg'), Math.random());

		return new Promise((resolveFn, rejectFn) => {
			const img = new Image();

			img.onload = resolveFn;
			img.onerror = rejectFn;

			window.setTimeout(rejectFn, 1000);

			img.src = target;
		});
	},

	/**
	 * Wait for device to come back online and reconnect to it.
	 *
	 * Poll each given hostname or IP address and navigate to it as soon as
	 * one of the addresses becomes reachable.
	 *
	 * @param {...string} [hosts=[window.location.host]]
	 * The list of IP addresses and host names to check for reachability.
	 * If omitted, the current value of `window.location.host` is used by
	 * default.
	 */
	awaitReconnect(...hosts) {
		const ipaddrs = hosts.length ? hosts : [ window.location.host ];

		window.setTimeout(L.bind(() => {
			poll.add(L.bind(() => {
				const tasks = [];
				let reachable = false;

				for (let i = 0; i < 2; i++)
					for (let j = 0; j < ipaddrs.length; j++)
						tasks.push(this.pingDevice(i ? 'https' : 'http', ipaddrs[j])
							.then(ev => { reachable = ev.target.src.replace(/^(https?:\/\/[^\/]+).*$/, '$1/') }, () => {}));

				return Promise.all(tasks).then(() => {
					if (reachable) {
						poll.stop();
						window.location = reachable;
					}
				});
			}, this));
		}, this), 5000);
	},

	/**
	 * @class
	 * @memberof LuCI.ui
	 * @hideconstructor
	 * @classdesc
	 *
	 * The `changes` class encapsulates logic for visualizing, applying,
	 * confirming and reverting staged UCI changesets.
	 *
	 * This class is automatically instantiated as part of `LuCI.ui`. To use it
	 * in views, use `'require ui'` and refer to `ui.changes`. To import it in
	 * external JavaScript, use `L.require("ui").then(...)` and access the
	 * `changes` property of the class instance value.
	 */
	changes: baseclass.singleton(/* @lends LuCI.ui.changes.prototype */ {
		init() {
			if (!L.env.sessionid)
				return;

			return uci.changes().then(L.bind(this.renderChangeIndicator, this));
		},

		/**
		 * Set the change count indicator.
		 *
		 * This function updates or hides the UCI change count indicator,
		 * depending on the passed change count. When the count is greater
		 * than 0, the change indicator is displayed or updated, otherwise it
		 * is removed.
		 *
		 * @instance
		 * @memberof LuCI.ui.changes
		 * @param {number} n
		 * The number of changes to indicate.
		 */
		setIndicator(n) {
			if (n > 0) {
				UI.prototype.showIndicator('uci-changes',
					'%s: %d'.format(_('Unsaved Changes'), n),
					L.bind(this.displayChanges, this));
			}
			else {
				UI.prototype.hideIndicator('uci-changes');
			}
		},

		/**
		 * Update the change count indicator.
		 *
		 * This function updates the UCI change count indicator from the given
		 * UCI changeset structure.
		 *
		 * @instance
		 * @memberof LuCI.ui.changes
		 * @param {Object<string, Array<LuCI.uci.ChangeRecord>>} changes
		 * The UCI changeset to count.
		 */
		renderChangeIndicator(changes) {
			let n_changes = 0;

			for (const config in changes)
				if (changes.hasOwnProperty(config))
					n_changes += changes[config].length;

			this.changes = changes;
			this.setIndicator(n_changes);
		},

		/** @private */
		changeTemplates: {
			'add-3':      '<ins>uci add %0 <strong>%3</strong> # =%2</ins>',
			'set-3':      '<ins>uci set %0.<strong>%2</strong>=%3</ins>',
			'set-4':      '<var><ins>uci set %0.%2.%3=<strong>%4</strong></ins></var>',
			'remove-2':   '<del>uci del %0.<strong>%2</strong></del>',
			'remove-3':   '<var><del>uci del %0.%2.<strong>%3</strong></del></var>',
			'order-3':    '<var>uci reorder %0.%2=<strong>%3</strong></var>',
			'list-add-4': '<var><ins>uci add_list %0.%2.%3=<strong>%4</strong></ins></var>',
			'list-del-4': '<var><del>uci del_list %0.%2.%3=<strong>%4</strong></del></var>',
			'rename-3':   '<var>uci rename %0.%2=<strong>%3</strong></var>',
			'rename-4':   '<var>uci rename %0.%2.%3=<strong>%4</strong></var>'
		},

		/**
		 * Display the current changelog.
		 *
		 * Open a modal dialog visualizing the currently staged UCI changes
		 * and offer options to revert or apply the shown changes.
		 *
		 * @instance
		 * @memberof LuCI.ui.changes
		 */
		displayChanges() {
			const list = E('div', { 'class': 'uci-change-list' });

			const dlg = UI.prototype.showModal(`${_('Configuration')} / ${_('Changes')}`, [
			E('div', { 'class': 'cbi-section' }, [
				E('strong', _('Legend:')),
				E('div', { 'class': 'uci-change-legend' }, [
					E('div', { 'class': 'uci-change-legend-label' }, [
						E('ins', '&#160;'), ' ', _('Section added') ]),
					E('div', { 'class': 'uci-change-legend-label' }, [
						E('del', '&#160;'), ' ', _('Section removed') ]),
					E('div', { 'class': 'uci-change-legend-label' }, [
						E('var', {}, E('ins', '&#160;')), ' ', _('Option changed') ]),
					E('div', { 'class': 'uci-change-legend-label' }, [
						E('var', {}, E('del', '&#160;')), ' ', _('Option removed') ])]),
				E('br'), list,
				E('div', { 'class': 'button-row' }, [
					E('button', {
						'class': 'btn cbi-button',
						'click': UI.prototype.hideModal
					}, [ _('Close') ]), ' ',
					new UIComboButton('0', {
						0: [ _('Save & Apply') ],
						1: [ _('Apply unchecked') ]
					}, {
						classes: {
							0: 'btn cbi-button cbi-button-positive important',
							1: 'btn cbi-button cbi-button-negative important'
						},
						click: L.bind((ev, mode) => { this.apply(mode == '0') }, this)
					}).render(), ' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-reset',
						'click': L.bind(this.revert, this)
					}, [ _('Revert') ])])])
		]);

			for (const config in this.changes) {
				if (!this.changes.hasOwnProperty(config))
					continue;

				list.appendChild(E('h5', '# /etc/config/%s'.format(config)));

				for (let i = 0, added = null; i < this.changes[config].length; i++) {
					const chg = this.changes[config][i];
					const tpl = this.changeTemplates['%s-%d'.format(chg[0], chg.length)];

					list.appendChild(E(tpl.replace(/%([01234])/g, (m0, m1) => {
						switch (+m1) {
						case 0:
							return config;

						case 2:
							if (added != null && chg[1] == added[0])
								return `@${added[1]}[-1]`;
							else
								return chg[1];

						case 4:
							return "'%h'".format(chg[3].replace(/'/g, "'\"'\"'"));

						default:
							return chg[m1-1];
						}
					})));

					if (chg[0] == 'add')
						added = [ chg[1], chg[2] ];
				}
			}

			list.appendChild(E('br'));
			dlg.classList.add('uci-dialog');
		},

		/** @private */
		displayStatus(type, content) {
			if (type) {
				const message = UI.prototype.showModal('', '');

				message.classList.add('alert-message');
				DOMTokenList.prototype.add.apply(message.classList, type.split(/\s+/));

				if (content)
					dom.content(message, content);

				if (!this.was_polling) {
					this.was_polling = request.poll.active();
					request.poll.stop();
				}
			}
			else {
				UI.prototype.hideModal();

				if (this.was_polling)
					request.poll.start();
			}
		},

		/** @private */
		checkConnectivityAffected() {
			return L.resolveDefault(fs.exec_direct('/usr/libexec/luci-peeraddr', null, 'json')).then(L.bind((info) => {
				if (L.isObject(info) && Array.isArray(info.inbound_interfaces)) {
					for (let i = 0; i < info.inbound_interfaces.length; i++) {
						const iif = info.inbound_interfaces[i];

						for (let j = 0; this.changes && this.changes.network && j < this.changes.network.length; j++) {
							const chg = this.changes.network[j];

							if (chg[0] == 'set' && chg[1] == iif &&
								((chg[2] == 'disabled' && chg[3] == '1') || chg[2] == 'proto' || chg[2] == 'ipaddr' || chg[2] == 'netmask'))
								return iif;
						}
					}
				}

				return null;
			}, this));
		},

		/** @private */
		rollback(checked) {
			if (checked) {
				this.displayStatus('warning spinning',
					E('p', _('Failed to confirm apply within %ds, waiting for rollback…')
						.format(L.env.apply_rollback)));

				const call = (r, data, duration) => {
					if (r.status === 204) {
						UI.prototype.changes.displayStatus('warning', [
							E('h4', _('Configuration changes have been rolled back!')),
							E('p', _('The device could not be reached within %d seconds after applying the pending changes, which caused the configuration to be rolled back for safety reasons. If you believe that the configuration changes are correct nonetheless, perform an unchecked configuration apply. Alternatively, you can dismiss this warning and edit changes before attempting to apply again, or revert all pending changes to keep the currently working configuration state.').format(L.env.apply_rollback)),
							E('div', { 'class': 'button-row' }, [
								E('button', {
									'class': 'btn',
									'click': L.bind(UI.prototype.changes.displayStatus, UI.prototype.changes, false)
								}, [ _('Dismiss') ]), ' ',
								E('button', {
									'class': 'btn cbi-button-action important',
									'click': L.bind(UI.prototype.changes.revert, UI.prototype.changes)
								}, [ _('Revert changes') ]), ' ',
								E('button', {
									'class': 'btn cbi-button-negative important',
									'click': L.bind(UI.prototype.changes.apply, UI.prototype.changes, false)
								}, [ _('Apply unchecked') ])
							])
						]);

						return;
					}

					const delay = isNaN(duration) ? 0 : Math.max(1000 - duration, 0);
					window.setTimeout(() => {
						request.request(L.url('admin/uci/confirm'), {
							method: 'post',
							timeout: L.env.apply_timeout * 1000,
							query: { sid: L.env.sessionid, token: L.env.token }
						}).then(call, call.bind(null, { status: 0, duration: 0 }));
					}, delay);
				};

				call({ status: 0 });
			}
			else {
				this.displayStatus('warning', [
					E('h4', _('Device unreachable!')),
					E('p', _('Could not regain access to the device after applying the configuration changes. You might need to reconnect if you modified network related settings such as the IP address or wireless security credentials.'))
				]);
			}
		},

		/** @private */
		confirm(checked, deadline, override_token) {
			let tt;
			let ts = Date.now();

			this.displayStatus('notice');

			if (override_token)
				this.confirm_auth = { token: override_token };

			const call = (r, data, duration) => {
				if (Date.now() >= deadline) {
					window.clearTimeout(tt);
					UI.prototype.changes.rollback(checked);
					return;
				}
				else if (r.status === 200 || r.status === 204) {
					document.dispatchEvent(new CustomEvent('uci-applied'));

					UI.prototype.changes.setIndicator(0);
					UI.prototype.changes.displayStatus('notice',
						E('p', _('Configuration changes applied.')));

					window.clearTimeout(tt);
					window.setTimeout(() => {
						//UI.prototype.changes.displayStatus(false);
						window.location = window.location.href.split('#')[0];
					}, L.env.apply_display * 1000);

					return;
				}

				const delay = isNaN(duration) ? 0 : Math.max(1000 - duration, 0);
				window.setTimeout(() => {
					request.request(L.url('admin/uci/confirm'), {
						method: 'post',
						timeout: L.env.apply_timeout * 1000,
						query: UI.prototype.changes.confirm_auth
					}).then(call, call.bind(null, { status: 0, duration: 0 }));
				}, delay);
			};

			const tick = () => {
				const now = Date.now();

				UI.prototype.changes.displayStatus('notice spinning',
					E('p', _('Applying configuration changes… %ds')
						.format(Math.max(Math.floor((deadline - Date.now()) / 1000), 0))));

				if (now >= deadline)
					return;

				tt = window.setTimeout(tick, 1000 - (now - ts));
				ts = now;
			};

			tick();

			/* wait a few seconds for the settings to become effective */
			window.setTimeout(call.bind(null, { status: 0 }), L.env.apply_holdoff * 1000);
		},

		/**
		 * Apply the staged configuration changes.
		 *
		 * Start applying staged configuration changes and open a modal dialog
		 * with a progress indication to prevent interaction with the view
		 * during the apply process. The modal dialog will be automatically
		 * closed and the current view reloaded once the apply process is
		 * complete.
		 *
		 * @instance
		 * @memberof LuCI.ui.changes
		 * @param {boolean} [checked=false]
		 * Whether to perform a checked (`true`) configuration apply or an
		 * unchecked (`false`) one.

		 * In case of a checked apply, the configuration changes must be
		 * confirmed within a specific time interval, otherwise the device
		 * will begin to roll back the changes in order to restore the previous
		 * settings.
		 */
		apply(checked) {
			this.displayStatus('notice spinning',
				E('p', _('Starting configuration apply…')));

			(new Promise((resolveFn, rejectFn) => {
				if (!checked)
					return resolveFn(false);

				UI.prototype.changes.checkConnectivityAffected().then(affected => {
					if (!affected)
						return resolveFn(true);

					UI.prototype.changes.displayStatus('warning', [
						E('h4', _('Connectivity change')),
						E('p', _('Changes have been made to the existing connection via "%h". This could inhibit access to this device. Any IP change requires <strong>connecting to the new IP</strong> within %d seconds to retain the changes.').format(affected, L.env.apply_rollback)),
						E('div', { 'class': 'button-row' }, [
							E('button', {
								'class': 'btn cbi-button',
								'click': rejectFn,
							}, [ _('Cancel') ]), ' ',
							E('button', {
								'class': 'btn cbi-button-action important',
								'click': resolveFn.bind(null, true)
							}, [ _('Apply checked') ]), ' ',
							E('button', {
								'class': 'btn cbi-button-negative important',
								'click': resolveFn.bind(null, false)
							}, [ _('Apply unchecked') ])
						])
					]);
				});
			})).then(checked => {
				request.request(L.url('admin/uci', checked ? 'apply_rollback' : 'apply_unchecked'), {
					method: 'post',
					query: { sid: L.env.sessionid, token: L.env.token }
				}).then(r => {
					if (r.status === (checked ? 200 : 204)) {
						let tok = null; try { tok = r.json(); } catch(e) {}
						if (checked && tok !== null && typeof(tok) === 'object' && typeof(tok.token) === 'string')
							UI.prototype.changes.confirm_auth = tok;

						UI.prototype.changes.confirm(checked, Date.now() + L.env.apply_rollback * 1000);
					}
					else if (checked && r.status === 204) {
						UI.prototype.changes.displayStatus('notice',
							E('p', _('There are no changes to apply')));

						window.setTimeout(() => {
							UI.prototype.changes.displayStatus(false);
						}, L.env.apply_display * 1000);
					}
					else {
						UI.prototype.changes.displayStatus('warning',
							E('p', _('Apply request failed with status <code>%h</code>')
								.format(r.responseText ?? r.statusText ?? r.status)));

						window.setTimeout(() => {
							UI.prototype.changes.displayStatus(false);
						}, L.env.apply_display * 1000);
					}
				});
			}, this.displayStatus.bind(this, false));
		},

		/**
		 * Revert the staged configuration changes.
		 *
		 * Start reverting staged configuration changes and open a modal dialog
		 * with a progress indication to prevent interaction with the view
		 * during the revert process. The modal dialog will be automatically
		 * closed and the current view reloaded once the revert process is
		 * complete.
		 *
		 * @instance
		 * @memberof LuCI.ui.changes
		 */
		revert() {
			this.displayStatus('notice spinning',
				E('p', _('Reverting configuration…')));

			request.request(L.url('admin/uci/revert'), {
				method: 'post',
				query: { sid: L.env.sessionid, token: L.env.token }
			}).then(r => {
				if (r.status === 200) {
					document.dispatchEvent(new CustomEvent('uci-reverted'));

					UI.prototype.changes.setIndicator(0);
					UI.prototype.changes.displayStatus('notice',
						E('p', _('Changes have been reverted.')));

					window.setTimeout(() => {
						//UI.prototype.changes.displayStatus(false);
						window.location = window.location.href.split('#')[0];
					}, L.env.apply_display * 1000);
				}
				else {
					UI.prototype.changes.displayStatus('warning',
						E('p', _('Revert request failed with status <code>%h</code>')
							.format(r.statusText ?? r.status)));

					window.setTimeout(() => {
						UI.prototype.changes.displayStatus(false);
					}, L.env.apply_display * 1000);
				}
			});
		}
	}),

	/**
	 * Add validation constraints to an input element.
	 *
	 * Compile the given type expression and optional validator function into
	 * a validation function and bind it to the specified input element events.
	 *
	 * @param {Node} field
	 * The DOM input element node to bind the validation constraints to.
	 *
	 * @param {string} type
	 * The datatype specification to describe validation constraints.
	 * Refer to the `LuCI.validation` class documentation for details.
	 *
	 * @param {boolean} [optional=false]
	 * Specifies whether empty values are allowed (`true`) or not (`false`).
	 * If an input element is not marked optional it must not be empty,
	 * otherwise it will be marked as invalid.
	 *
	 * @param {function} [vfunc]
	 * Specifies a custom validation function which is invoked after the
	 * other validation constraints are applied. The validation must return
	 * `true` to accept the passed value. Any other return type is converted
	 * to a string and treated as validation error message.
	 *
	 * @param {...string} [events=blur, keyup]
	 * The list of events to bind. Each received event will trigger a field
	 * validation. If omitted, the `keyup` and `blur` events are bound by
	 * default.
	 *
	 * @returns {function}
	 * Returns the compiled validator function which can be used to trigger
	 * field validation manually or to bind it to further events.
	 *
	 * @see LuCI.validation
	 */
	addValidator(field, type, optional, vfunc, ...events) {
		if (type == null)
			return;

		if (events.length == 0)
			events.push('blur', 'keyup');

		try {
			const cbiValidator = validation.create(field, type, optional, vfunc);
			const validatorFn = cbiValidator.validate.bind(cbiValidator);

			for (let i = 0; i < events.length; i++)
				field.addEventListener(events[i], validatorFn);

			validatorFn();

			return validatorFn;
		}
		catch (e) { }
	},

	/**
	 * Create a pre-bound event handler function.
	 *
	 * Generate and bind a function suitable for use in event handlers. The
	 * generated function automatically disables the event source element
	 * and adds an active indication to it by adding appropriate CSS classes.
	 *
	 * It will also await any promises returned by the wrapped function and
	 * re-enable the source element after the promises ran to completion.
	 *
	 * @param {*} ctx
	 * The `this` context to use for the wrapped function.
	 *
	 * @param {function|string} fn
	 * Specifies the function to wrap. In case of a function value, the
	 * function is used as-is. If a string is specified instead, it is looked
	 * up in `ctx` to obtain the function to wrap. In both cases the bound
	 * function will be invoked with `ctx` as `this` context
	 *
	 * @param {...*} extra_args
	 * Any further parameter as passed as-is to the bound event handler
	 * function in the same order as passed to `createHandlerFn()`.
	 *
	 * @returns {function|null}
	 * Returns the pre-bound handler function which is suitable to be passed
	 * to `addEventListener()`. Returns `null` if the given `fn` argument is
	 * a string which could not be found in `ctx` or if `ctx[fn]` is not a
	 * valid function value.
	 */
	createHandlerFn(ctx, fn, ...args) {
		if (typeof(fn) == 'string')
			fn = ctx[fn];

		if (typeof(fn) != 'function')
			return null;

		return L.bind(function() {
			const t = arguments[args.length].currentTarget;

			t.classList.add('spinning');
			t.disabled = true;

			if (t.blur)
				t.blur();

			Promise.resolve(fn.apply(ctx, arguments)).finally(() => {
				t.classList.remove('spinning');
				t.disabled = false;
			});
		}, ctx, ...args);
	},

	/**
	 * Load specified view class path and set it up.
	 *
	 * Transforms the given view path into a class name, requires it
	 * using [LuCI.require()]{@link LuCI#require} and asserts that the
	 * resulting class instance is a descendant of
	 * [LuCI.view]{@link LuCI.view}.
	 *
	 * By instantiating the view class, its corresponding contents are
	 * rendered and included into the view area. Any runtime errors are
	 * caught and rendered using [LuCI.error()]{@link LuCI#error}.
	 *
	 * @param {string} path
	 * The view path to render.
	 *
	 * @returns {Promise<LuCI.view>}
	 * Returns a promise resolving to the loaded view instance.
	 */
	instantiateView(path) {
		const className = 'view.%s'.format(path.replace(/\//g, '.'));

		return L.require(className).then(view => {
			if (!(view instanceof View))
				throw new TypeError('Loaded class %s is not a descendant of View'.format(className));

			return view;
		}).catch(err => {
			dom.content(document.querySelector('#view'), null);
			L.error(err);
		});
	},

	menu: UIMenu,

	Table: UITable,

	AbstractElement: UIElement,

	/* Widgets */
	Textfield: UITextfield,
	Textarea: UITextarea,
	Checkbox: UICheckbox,
	Select: UISelect,
	Dropdown: UIDropdown,
	DynamicList: UIDynamicList,
	RangeSlider: UIRangeSlider,
	Combobox: UICombobox,
	ComboButton: UIComboButton,
	Hiddenfield: UIHiddenfield,
	FileUpload: UIFileUpload
});

return UI;
