export interface ResponseVO<T> {
  success: boolean;
  code: number;
  message: string;
  data: T;
}

export type SpaceVO = {
  id: string,
  name: string,
  isAdmin: boolean,
}

export type NodeVO = {
  id: string,
  name: string,
  type: string,
  icon: string,
  isFav: string,
  permission: string
}

export type ToolNodeVO = {
  node_id: string,
  name: string,
  type: string,
  icon: string,
  isFav: string,
  permission: string
}

export type RecordVO = {
  recordId: string,
  fields: Record<string, any>,
  createdAt?: number,
  updatedAt?: number,
}

export type CellVO = {
  id: string,
  name: string,
  fieldType: string,
  value: any,
  data: any,
}

export type GetRecordsResponeDataVO = {
  total: number,
  pageSize: number,
  pageNum: number,
  records: RecordVO[],
}

export type attachmentVO = {
  token: string,
  name: string,
  mimeType: string,
  url: string,
  size: number,
  height?: number,
  width?: number,
}

export type FieldSchemaVO = {
  id: string,
  name: string,
  desc?: string,
  type: string,
  property?: any,
  editable?: boolean,
  isPrimary?: boolean,
}

export type SelectFieldOptionVO = {
  id: string,
  name: string,
  color: string,
}

export interface FieldFormatJSONSchema {
  json_schema: FieldFormatJSONSchema.JSONSchema;

  /**
   * The type of field format being defined: `json_schema`
   */
  type: 'json_schema';
}

export namespace FieldFormatJSONSchema {
  export interface JSONSchema {
    /**
     * The name of the database fields schema format. Must be a-z, A-Z, 0-9, or contain underscores
     * and dashes, with a maximum length of 64.
     */
    name: string;

    /**
     * A description of what the fields schema format is for, used by the model to determine
     * how to respond in the format.
     */
    description?: string;

    /**
     * The schema for the fields schema format, described as a JSON Schema object.
     */
    schema?: Record<string, unknown>;

    /**
     * Whether to enable strict schema adherence when generating the output. If set to
     * true, the model will always follow the exact schema defined in the `schema`
     * field. Only a subset of JSON Schema is supported when `strict` is `true`. To
     * learn more, read the
     * [Structured Outputs guide](https://platform.openai.com/docs/guides/structured-outputs).
     */
    strict?: boolean | null;
  }
}