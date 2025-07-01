import nodeFetch, { RequestInit } from "node-fetch";
import type {
  attachmentVO,
  FieldFormatJSONSchema,
  FieldSchemaVO,
  RecordVO,
  ResponseVO,
  SelectFieldOptionVO,
} from "./types.js";

export class AitableService {
  private readonly apiKey: string;

  private readonly baseUrl: string;

  private readonly fetch: typeof nodeFetch;

  constructor(
    apiKey: string,
    baseUrl: string,
    fetch: typeof nodeFetch = nodeFetch
  ) {
    if (!apiKey) {
      throw new Error("Please set the AITABLE_API_KEY environment variable.");
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetch = fetch;
  }

  public async fetchFromAPI<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ResponseVO<T>> {
    const response = await this.fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const responseJson = (await response.json()) as ResponseVO<T>;

    if (!response.ok) {
      throw new Error(
        `AITable API Error: ${response.statusText}. Response: ${responseJson.message}`
      );
    }

    try {
      return responseJson;
    } catch (error) {
      throw new Error(
        `Failed to parse API response: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Validates required parameters and builds a query string from provided parameters
   * @param params Object containing parameters to validate and convert to query string
   * @param requiredParams Array of parameter names that are required
   * @returns Formatted query string starting with '?' if parameters exist
   */
  public buildQueryString(
    params: Record<string, any>,
    requiredParams: string[] = []
  ): string {
    // Validate required parameters
    for (const param of requiredParams) {
      if (
        params[param] === undefined ||
        params[param] === null ||
        params[param] === ""
      ) {
        throw new Error(`Query parameter '${param}' is required.`);
      }
    }

    // Build query parameters
    const queryParams: string[] = [];

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        // Handle array parameters (like sort)
        if (value.length > 0) {
          const arrayStr = JSON.stringify(value);
          queryParams.push(
            `${encodeURIComponent(key)}=${encodeURIComponent(arrayStr)}`
          );
        }
      } else if (typeof value === "object") {
        // Handle object parameters
        const objStr = JSON.stringify(value);
        queryParams.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(objStr)}`
        );
      } else if (value !== "") {
        // Handle primitive parameters
        queryParams.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(value.toString())}`
        );
      }
    }

    return queryParams.length > 0 ? `?${queryParams.join("&")}` : "";
  }

  /**
   * get the type-specific keywords for a field based on its type.
   *
   * warning: To use Structured Outputs, all fields or function parameters must be specified as `required`.
   * Although all fields must be required (and the model will return a value for each parameter), it is possible to emulate an optional parameter by using a union type with `null`.
   */
  private _getKeywordByFieldType(field: FieldSchemaVO): object | null {
    if (
      ["Text", "SingleText", "Email ", "URL", "Phone"].includes(field.type)
    ) {
      return { type: "string" };
    }

    if (field.type === "Checkbox") {
      return { type: "boolean" };
    }

    if (["Number", "Currency", "Percent"].includes(field.type)) {
      return { type: "number" };
    }

    if (field.type === "Rating") {
      // openAI does not support `max` property in JSON schema, so we will just use description for providing the range
      const description =
        field.property && "max" in field.property
          ? `Rating from 0 to ${field.property.max}. if over ${field.property.max}, reduce to ${field.property.max}`
          : "";
      return { type: "integer", description };
    }

    if (field.type === "DateTime") {
      return {
        type: "string",
        description:
          "ISO 8601 date-time format, with UTC timezone. Example: 2022-01-01T12:00:00Z",
      };
    }

    if (field.type === "SingleSelect") {
      return {
        type: "string",
        enum: field.property?.options?.map(
          (option: SelectFieldOptionVO) => option.name
        ),
        description:
          "Single selection from the provided options. If no options are available, return a null value.",
      }
    }

    if (field.type === "MultiSelect") {
      if (field.property && "options" in field.property) {
        const enumValues = field.property.options.map(
          (option: SelectFieldOptionVO) => option.name
        );
        return {
          type: "array",
          items: {
            type: "string",
            enum: enumValues,
            description: "one or more selections",
          },
        };
      }
    }

    if (field.type === "Attachment") {
      return {
        type: "array",
        items: {
          properties: {
            token: { type: "string" },
            name: { type: "string" },
            mimeType: { type: "string" },
            url: { type: "string" },
            size: { type: "number" },
            height: { type: "number", nullable: true },
            width: { type: "number", nullable: true },
          },
        }
      };
    }

    // TODO: Add support for MEMBER field

    return null; // Return null if the field type is not supported
  }

  private _getCellValueByFieldType(
    field: FieldSchemaVO,
    fieldValue: unknown
  ): unknown {
    if (field.type === "Text" || 
      field.type === "SingleText" || 
      field.type === "Email" || 
      field.type === "URL" || 
      field.type === "Phone" ||
      field.type === "SingleSelect"
    ) {
      return String(fieldValue);
    }

    if (field.type === "Checkbox") {
      return Boolean(fieldValue);
    }

    if (["Number", "Currency", "Percent", "Rating"].includes(field.type)) {
      return Number(fieldValue);
    }

    if (field.type === "DateTime" && typeof fieldValue === "string") {
      return fieldValue !== "" ? new Date(String(fieldValue)).toISOString() : null;
    }

    if (field.type === "MultiSelect") {
      if (Array.isArray(fieldValue)) {
        const validOptionIds = fieldValue
          .map((optionName: string) => {
            const option = (field.property?.options as SelectFieldOptionVO[])?.find(
              (option: SelectFieldOptionVO) => option.name === optionName
            );
            return option ? option.id : null;
          })
          .filter((id): id is string => id !== null);
          
          return validOptionIds;
      } else if (typeof fieldValue === "string") {
        const option = (field.property?.options as SelectFieldOptionVO[])?.find(
          (option: SelectFieldOptionVO) => option.name === fieldValue
        );
        return option ? [option.id] : [];
      }
    }

    return null; // Return null for unsupported field types
  }

  public convertFieldValuesToCellFormat(
    fieldsSchema: FieldSchemaVO[],
    fieldValues: Record<string, unknown>
  ): Record<string, unknown> {
    const cells: Record<string, unknown> = {};

    fieldsSchema.forEach((fieldschema) => {
      const fieldValue = fieldValues[fieldschema.name];
      if (fieldValue !== undefined) {
        const cellValue = this._getCellValueByFieldType(
          fieldschema,
          fieldValue
        );

        // Only add the cell if the value is not null
        if (cellValue !== null) {
          cells[fieldschema.name] = cellValue;
        }
      }
    });

    return cells;
  }

  /**
   * Generate a JSON schema based on the provided fields.
   * This schema will be sent to OpenAI to help the AI understand the expected structure of the data.
   */
  public getFieldsJSONSchema(fields: FieldSchemaVO[]): FieldFormatJSONSchema {
    const schema: {
      type: string;
      properties: Record<string, unknown>;
      additionalProperties: boolean;
      required: string[];
    } = {
      type: "object",
      properties: {},
      additionalProperties: false,
      required: [],
    };

    fields.forEach((field) => {
      const keywordsForField = this._getKeywordByFieldType(field);

      // If the field type is not supported, we skip it
      if (keywordsForField) {
        schema.properties[field.name] = keywordsForField;
        schema.required.push(field.name);
      }
    });

    return {
      type: "json_schema",
      json_schema: {
        name: "fields_in_datasheet",
        schema,
        strict: true,
      },
    };
  }

  private async _fetchFileViaURL(file_url: string): Promise<Blob> {
    if (!file_url) {
      throw new Error("file_url is required.");
    }
    const response = await this.fetch(file_url)

    if (!response.ok) {
      throw new Error(
        `Fetch file error: ${response.statusText}. Response: ${await response.text()}`
      );
    }

    return response.blob();
  }

  public async uploadFileToSpace(
    node_id: string,
    file_url: string,
    file_name?: string,
  ): Promise<ResponseVO<attachmentVO[]>> {

    // get the file name from file_url if not provided
    if(!file_name) {
      const url = new URL(file_url);
      file_name = url.pathname.split("/").pop() ?? "file_"+new Date().getTime();
    }

    // Fetch the file from the provided URL
    const fileBlob = await this._fetchFileViaURL(file_url);
    const formData = new FormData();
    formData.append("file", fileBlob, file_name);

    const endpoint = `/v1/datasheets/${node_id}/attachments`;

    const response =  await this.fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
      method: "POST",
    });

    const responseJson = (await response.json()) as ResponseVO<attachmentVO[]>;

    if (!response.ok) {
      throw new Error(
        `AITable API Error: ${response.statusText}. Response: ${responseJson.message}`
      );
    }

    return responseJson;
  }

  public async getDatasheetFieldsSchema(
    node_id: string
  ): Promise<ResponseVO<{fields: FieldSchemaVO[]}>> {
    if (!node_id) {
      throw new Error("The datasheet ID (node_id) is required.");
    }

    const endpoint = `/v1/datasheets/${node_id}/fields`;

    return this.fetchFromAPI(endpoint, {
      method: "GET",
    });
  }

  public async createDatasheetRecord(
    node_id: string,
    cells: Record<string, unknown>
  ): Promise<ResponseVO<{records: RecordVO[]}>> {

    const endpoint = `/v1/datasheets/${node_id}/records`;

    console.error('Creating record with cells:', cells);

    return this.fetchFromAPI(endpoint, {
      method: "POST",
      body: JSON.stringify({
        records:[
          {
            fields: cells,
          }
        ]
      }),
    });
  }
}
